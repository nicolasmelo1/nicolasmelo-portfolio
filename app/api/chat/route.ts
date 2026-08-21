import { NextResponse } from "next/server";
import type { Spec } from "@json-render/core";
import { retrievePortfolio } from "@/lib/retrieve";
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
  const body = (await request.json()) as { query?: string; spec?: Spec };
  const query = body.query?.trim();
  const currentSpec = parsePortfolioSpec(body.spec);

  if (!query || !currentSpec) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const context = retrievePortfolio(query);
  // Read the repositories the question justifies, before deciding who authors
  // the Δ — the deterministic author uses them too, so a rate-limited or
  // offline GitHub degrades the answer identically on both paths.
  const repos = await readReposFor(query, context);

  const fallback = () =>
    NextResponse.json({
      delta: checkedDeterministicDelta(currentSpec, query, context, repos),
      source: "deterministic",
    });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallback();

  try {
    const prompt = buildDeltaPrompt(query, currentSpec, context, repos);
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
        max_tokens: 2200,
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

    return NextResponse.json({ delta, source: "cloud" });
  } catch (error) {
    // Logged, not swallowed. Every OpenRouter failure used to look identical to
    // "no key configured" from the outside — the response just said
    // `deterministic` — which made a broken model id, a refused transaction and
    // a missing env var indistinguishable in the one place they matter.
    console.warn(`[openrouter] ${MODEL} failed, falling back to the deterministic author:`, error);
    return fallback();
  }
}
