import { NextResponse } from "next/server";
import type { Spec } from "@json-render/core";
import { resolveTurn, sanitizeHistory } from "@/lib/conversation";
import { flowKey, readFlow, writeFlow } from "@/lib/llm/cache";
import { readReposFor } from "@/lib/sources/github";
import { checkedDeterministicDelta, validateDeltaAgainstSpec } from "@/lib/ui/delta";
import { buildDeltaPrompt } from "@/lib/ui/prompt";
import { extractJsonObject } from "@/lib/ui/stream";
import { parsePortfolioSpec } from "@/lib/ui/spec";

/**
 * Which OpenRouter model authors the Δ.
 *
 * `openrouter/free` is the default because it costs nothing, but it routes to
 * whatever free model is available — measured at 19s to 87s, sometimes rate
 * limited, sometimes returning a transaction that does not parse. Paid models
 * of this size answered in ~11s for fractions of a cent; set this to pick one.
 */
const MODEL = process.env.OPENROUTER_MODEL ?? "openrouter/free";

export async function POST(request: Request) {
  const body = (await request.json()) as { query?: string; spec?: Spec; history?: unknown };
  const query = body.query?.trim();
  const currentSpec = parsePortfolioSpec(body.spec);

  if (!query || !currentSpec) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // The questions already asked, so a pronoun has something to point at.
  // Retrieval is pure, which is why the prior *questions* are enough to recover
  // the prior *subjects* — see `lib/conversation.ts`.
  const history = sanitizeHistory(body.history);
  const { intent, capsules } = resolveTurn(query, history);
  // Read the repositories the question justifies, before deciding who authors
  // the Δ — the deterministic author uses them too, so a rate-limited or
  // offline GitHub degrades the answer identically on both paths.
  const repos = await readReposFor(query, capsules);

  const fallback = () =>
    NextResponse.json({
      delta: checkedDeterministicDelta(currentSpec, query, capsules, repos, intent),
      source: "deterministic",
    });

  // Answered before the model is asked. `source` still says `cloud` because a
  // model did write this transaction; the header is how a hit can be seen from
  // outside without putting a fourth author in the interface.
  const key = flowKey(query, history, currentSpec);
  const cached = readFlow(key, currentSpec);
  if (cached) {
    return NextResponse.json({ delta: cached, source: "cloud" }, { headers: { "x-flow-cache": "hit" } });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallback();

  try {
    const prompt = buildDeltaPrompt(query, currentSpec, capsules, repos, history, intent);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.1,
        // A four-capsule answer measured 45 to 53 ops, which is more than 2,200
        // tokens: one sample in nine came back `finish_reason: length`, with the
        // JSON cut mid-op and nothing the gate could accept. The cap is on output
        // and the model is billed per token it actually writes, so raising it
        // costs nothing on the answers that were already fitting.
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty model response");

    const json = extractJsonObject(content);
    if (!json) throw new Error("Model reply contained no JSON object");
    const delta = validateDeltaAgainstSpec(currentSpec, JSON.parse(json));
    if (!delta) throw new Error("Model returned a transaction the gate refused");

    writeFlow(key, delta);
    return NextResponse.json({ delta, source: "cloud" }, { headers: { "x-flow-cache": "miss" } });
  } catch (error) {
    // Logged, not swallowed. Every OpenRouter failure used to look identical to
    // "no key configured" from the outside — the response just said
    // `deterministic` — which made a broken model id, a refused transaction and
    // a missing env var indistinguishable in the one place they matter.
    console.warn("[openrouter] falling back to the deterministic author:", MODEL, error);
    return fallback();
  }
}
