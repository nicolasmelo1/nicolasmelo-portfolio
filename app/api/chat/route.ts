import { NextResponse } from "next/server";
import type { Spec } from "@json-render/core";
import { retrievePortfolio } from "@/lib/retrieve";
import { readReposFor } from "@/lib/sources/github";
import { applyOps, type Op } from "@/lib/runtime/ops";
import { deterministicDelta, parseDelta } from "@/lib/ui/delta";
import { buildDeltaPrompt } from "@/lib/ui/prompt";
import { parsePortfolioSpec } from "@/lib/ui/spec";

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/**
 * A Δ is only worth returning if it actually applies. Trial-applying it here,
 * against the same spec the client holds, means a malformed transaction becomes
 * a fallback on the server rather than a thrown op in the browser — and the
 * resulting document is checked against the catalog too, so a Δ can neither
 * fail to run nor run into something unrenderable.
 */
function applies(spec: Spec, ops: Op[]) {
  try {
    return parsePortfolioSpec(applyOps(spec, ops).next) !== null;
  } catch {
    return false;
  }
}

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
      delta: deterministicDelta(currentSpec, query, context, repos),
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
        model: "openrouter/free",
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

    const delta = parseDelta(JSON.parse(stripCodeFence(content)));
    if (!delta) throw new Error("Model returned an invalid transaction");
    if (!applies(currentSpec, delta.ops)) throw new Error("Transaction does not apply");

    return NextResponse.json({ delta, source: "cloud" });
  } catch {
    return fallback();
  }
}
