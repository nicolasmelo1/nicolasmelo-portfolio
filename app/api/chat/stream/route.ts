import type { Spec } from "@json-render/core";
import { retrievePortfolio } from "@/lib/retrieve";
import { applyApplicable, opSchema, type Op } from "@/lib/runtime/ops";
import { readReposFor } from "@/lib/sources/github";
import { buildDeltaPrompt } from "@/lib/ui/prompt";
import { parsePortfolioSpec } from "@/lib/ui/spec";
import { createOpScanner } from "@/lib/ui/stream";

/**
 * The model's transaction, streamed op by op.
 *
 * Generation is the dominant cost — measured at 11 to 87 seconds depending on
 * the model — and the ops inside a transaction are independent, ordered, and
 * each carries an inverse. So they can be applied as they close instead of all
 * at the end, and the interface assembles itself while the model is still
 * writing.
 *
 * Every op is applied here first, against a mirror of the client's document. A
 * client therefore only ever receives ops that are known to apply, which keeps
 * the gate's promise — no author is trusted — intact while streaming, where
 * there is no complete transaction to validate yet.
 */

const MODEL = process.env.OPENROUTER_MODEL ?? "openrouter/free";

type Line =
  | { type: "label"; label: string }
  | { type: "op"; op: Op }
  | { type: "done" }
  | { type: "unavailable"; reason: string }
  | { type: "error"; reason: string };

const encoder = new TextEncoder();
const encode = (line: Line) => encoder.encode(`${JSON.stringify(line)}\n`);

/** `data:` payloads from an SSE body, in order. */
function sseData(chunk: string): string[] {
  return chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
}

function contentDelta(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string | null } }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

async function openRouter(system: string, user: string, apiKey: string, signal: AbortSignal) {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 2200,
      stream: true,
    }),
    signal,
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { query?: string; spec?: Spec };
  const query = body.query?.trim();
  const startingSpec = parsePortfolioSpec(body.spec);

  if (!query || !startingSpec) {
    return new Response(JSON.stringify({ error: "invalid request" }), { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Answered rather than refused: the client needs to know to stop waiting.
    return new Response(encode({ type: "unavailable", reason: "no api key" }), {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const context = retrievePortfolio(query);
  const repos = await readReposFor(query, context);
  const prompt = buildDeltaPrompt(query, startingSpec, context, repos);

  /**
   * Drain the upstream body, emitting each op that closes.
   *
   * Returns the mirrored document, so the caller can put the finished thing
   * through the catalog gate.
   */
  async function pump(
    body: ReadableStream<Uint8Array>,
    from: Spec,
    send: (line: Line) => void,
  ): Promise<{ mirror: Spec; applied: number }> {
    const scanner = createOpScanner();
    // Decoded by hand rather than through TextDecoderStream: the pipeThrough
    // overload does not line up with the DOM types here, and this is one line.
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let mirror = from;
    let applied = 0;
    let skipped = 0;
    let carry = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // SSE frames split across reads, so the tail waits for its newline.
      carry += decoder.decode(value, { stream: true });
      const cut = carry.lastIndexOf("\n");
      if (cut === -1) continue;
      const ready = carry.slice(0, cut);
      carry = carry.slice(cut + 1);

      for (const payload of sseData(ready)) {
        const result = scanner.push(contentDelta(payload));
        if (result.label) send({ type: "label", label: result.label });

        for (const candidate of result.ops) {
          const parsed = opSchema.safeParse(candidate);
          if (!parsed.success) {
            skipped += 1;
            continue;
          }

          // Applied here first, so the client never receives an op that would
          // throw in its kernel — and an op that cannot apply is dropped rather
          // than aborting a transaction that is otherwise fine. `unregister` of
          // the root was the real case.
          const step = applyApplicable(mirror, [parsed.data]);
          if (!step.applied.length) {
            skipped += 1;
            continue;
          }

          mirror = step.next;
          applied += 1;
          send({ type: "op", op: parsed.data });
        }
      }
    }

    if (skipped) console.warn("[openrouter stream] dropped inapplicable op(s):", skipped);
    return { mirror, applied };
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Line) => controller.enqueue(encode(line));

      try {
        const upstream = await openRouter(prompt.system, prompt.user, apiKey, request.signal);
        if (!upstream.ok || !upstream.body) {
          throw new Error(`OpenRouter returned ${upstream.status}`);
        }

        const { mirror, applied } = await pump(upstream.body, startingSpec, send);
        if (!applied) throw new Error("model emitted no operations");
        // The whole point of a transaction: the finished document has to be one
        // the catalog accepts, not just a sequence that happened to apply.
        if (!parsePortfolioSpec(mirror)) {
          throw new Error("finished document failed the catalog gate");
        }

        send({ type: "done" });
      } catch (error) {
        console.warn("[openrouter stream] failed:", MODEL, error);
        send({ type: "error", reason: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
