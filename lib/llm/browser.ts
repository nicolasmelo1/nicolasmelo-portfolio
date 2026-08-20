"use client";

import type { Spec } from "@json-render/core";
import { DEFAULT_MODEL, FALLBACK_MODEL, REQUESTED_CONTEXT } from "@/lib/llm/models";
import type { PortfolioCapsule } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";
import { parseDelta } from "@/lib/ui/delta";
import { buildDeltaPrompt } from "@/lib/ui/prompt";

export type ChatRequest = {
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature?: number;
  response_format?: { type: "json_object"; schema?: string };
};

/**
 * Build the request. Deliberately sends no `response_format`.
 *
 * web-llm 0.2.84 has grammar-constrained decoding, and it looked like the right
 * answer here: a grammar compiled from the Δ schema would make malformed JSON
 * impossible, which is the failure mode a small model actually has. It does not
 * work in this version.
 *
 *   - `{ type: "json_object" }` with no schema is broken by construction. The
 *     pipeline calls `compileJSONSchema(responseFormat.schema)` unconditionally,
 *     so an absent schema reaches a `std::string` binding as `undefined` and
 *     throws `BindingError: Cannot pass non-string to std::string`. That rules
 *     it out as a fallback.
 *   - `{ type: "json_object", schema }` with our schema threw the same binding
 *     error in a real browser. The grammar is compiled inside a promise the
 *     request never awaits, so the failure surfaces as an uncaught rejection
 *     and then leaves a disposed GrammarMatcher behind. A plausible cause is
 *     the `oneOf` that zod emits for the op union, which XGrammar may not
 *     accept, but that is a guess: this cannot be reproduced without WebGPU,
 *     which no test environment here has.
 *
 * Shipping a path that throws in the user's browser and cannot be verified is
 * worse than not shipping it. Validity does not depend on the grammar: every Δ
 * goes through `parseDelta`, and anything it rejects falls through to the
 * deterministic author. The grammar would only have saved a retry.
 *
 * Re-test with `{ type: "json_object", schema }` when web-llm updates.
 */
export function buildChatRequest(prompt: { system: string; user: string }): ChatRequest {
  return {
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: 0.1,
  };
}

type Engine = {
  chat: {
    completions: {
      create: (
        request: ChatRequest,
      ) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
};

/** Narrow view of the Network Information API, which the DOM lib does not type. */
type SaveDataNavigator = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
};

function supportsLocalModel() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export type SkipReason = "no-webgpu" | "data-saver" | "slow-connection";

/**
 * Whether to start the model download without being asked, and if not, why.
 *
 * Auto-loading is the point — the model should be ready before anyone needs it
 * — but "in the background" is not permission to spend someone's mobile data.
 * A visitor who asked their browser to save data, or who is on a slow radio,
 * gets the server route instead.
 *
 * It returns the reason rather than a boolean because the three cases are not
 * interchangeable: one is a browser that cannot run the model at all, the other
 * two are a deliberate choice to be frugal. Collapsing them into one "server
 * model" label made the fallback impossible to diagnose from the page.
 */
export function autoLoadSkipReason(): SkipReason | null {
  if (!supportsLocalModel()) return "no-webgpu";
  const connection = (navigator as SaveDataNavigator).connection;
  if (connection?.saveData) return "data-saver";
  if (connection?.effectiveType && /(^|-)(2g|3g)$/.test(connection.effectiveType)) {
    return "slow-connection";
  }
  return null;
}

export type LoadPhase = "idle" | "loading" | "ready" | "unavailable";

/**
 * Build the worker.
 *
 * The worker is pre-bundled to `public/llm-worker.js` by `npm run build:worker`
 * rather than referenced as `new Worker(new URL("./worker.ts", ...))`.
 *
 * That is not a preference. Turbopack did not treat the inline form as a worker
 * entry: it emitted `lib/llm/worker.ts` verbatim into `static/media/` and served
 * it as `Content-Type: video/mp2t` — the MPEG transport-stream type for a `.ts`
 * extension. The browser will not execute that as a module, and the failure is
 * silent, so the page reported an unavailable model with no reason. Hoisting the
 * call to a top-level function did not change the output.
 *
 * esbuild produces a real ES module with web-llm inlined, from our own origin,
 * with no CDN in the path.
 */
function createModelWorker() {
  return new Worker("/llm-worker.js", { type: "module" });
}

let enginePromise: Promise<Engine> | null = null;
let activeModelId: string | null = null;

/** Bring up one model in a fresh worker. Rejects, and cleans up, on failure. */
async function initEngine(modelId: string, onProgress?: (message: string) => void) {
  const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  const worker = createModelWorker();

  // A worker that fails to load does not reject anything on its own: the engine
  // handshake simply never completes, and the page reports a blank "unavailable"
  // forever. These two handlers are what turn a bundling or syntax failure
  // inside the worker into a message someone can act on.
  const workerFailure = new Promise<never>((_, reject) => {
    worker.onerror = (event: ErrorEvent) => {
      reject(
        new Error(
          `worker failed to start: ${event.message || "no message"}` +
            (event.filename ? ` (${event.filename}:${event.lineno})` : ""),
        ),
      );
    };
    worker.onmessageerror = () => {
      reject(new Error("worker could not deserialize a message"));
    };
  });

  try {
    const engine = await Promise.race([
      CreateWebWorkerMLCEngine(
        worker,
        modelId,
        { initProgressCallback: (report) => onProgress?.(report.text) },
        // Override web-llm's 4096. Without this the prompt does not fit and the
        // model reports ready, then fails on every request.
        { context_window_size: REQUESTED_CONTEXT },
      ),
      workerFailure,
    ]);
    activeModelId = modelId;
    return engine as unknown as Engine;
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

/**
 * Start (or join) the model load. Safe to call repeatedly: the first call owns
 * the worker and every later one waits on the same promise, so an auto-load on
 * mount and a click on the same tick cannot produce two engines.
 *
 * If the preferred model cannot initialise, the fallback is tried once. That is
 * not defensive padding: the previous default could not start at all on this
 * runtime, and "slower answers" is a much better outcome than "no local model".
 */
export function startLocalModel(onProgress?: (message: string) => void): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      if (!supportsLocalModel()) throw new Error("WebGPU is not available in this browser.");

      try {
        return await initEngine(DEFAULT_MODEL.id, onProgress);
      } catch (error) {
        console.warn(`[local model] ${DEFAULT_MODEL.id} failed, trying fallback`, error);
        onProgress?.(`${DEFAULT_MODEL.label} failed — trying ${FALLBACK_MODEL.label}`);
        return await initEngine(FALLBACK_MODEL.id, onProgress);
      }
    })().catch((error: unknown) => {
      // A failed load must not poison every later attempt.
      enginePromise = null;
      activeModelId = null;
      // The page shows a short version; the console keeps the whole thing,
      // because this is the class of failure that is invisible otherwise.
      console.error("[local model] load failed", error);
      throw error;
    });
  }
  return enginePromise;
}

/** Which model actually came up, once one has. */
export function activeModel() {
  return activeModelId;
}

export function localModelStarted() {
  return enginePromise !== null;
}

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/**
 * Fetch the context for a question from our own server.
 *
 * The server holds the repository cache and spends its own GitHub budget, so
 * this is one request instead of four per repository from the visitor's IP. If
 * it fails, retrieval still works locally — only the repository depth is lost,
 * which is the right thing to lose when the network is the thing that broke.
 */
async function fetchContext(query: string) {
  try {
    const response = await fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new Error(`context endpoint returned ${response.status}`);
    const payload = (await response.json()) as {
      capsules?: PortfolioCapsule[];
      repos?: Record<string, unknown>;
    };
    if (!payload.capsules?.length) throw new Error("context endpoint returned nothing");
    return { capsules: payload.capsules, repos: payload.repos ?? {} };
  } catch {
    return { capsules: retrievePortfolio(query), repos: {} };
  }
}

/** Ask the local model for one Δ. Returns null if it produced anything invalid. */
export async function generateDeltaInBrowser(query: string, currentSpec: Spec) {
  const engine = await startLocalModel();
  const { capsules, repos } = await fetchContext(query);
  const prompt = buildDeltaPrompt(query, currentSpec, capsules, repos);
  const result = await engine.chat.completions.create(buildChatRequest(prompt));

  const content = result.choices[0]?.message?.content;
  if (!content || typeof content !== "string") return null;

  try {
    return parseDelta(JSON.parse(stripCodeFence(content)));
  } catch {
    return null;
  }
}
