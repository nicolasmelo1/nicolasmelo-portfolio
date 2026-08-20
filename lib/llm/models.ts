/**
 * The browser models worth considering, with numbers measured rather than
 * guessed: `downloadMB` is the summed file size of the MLC repository on
 * Hugging Face, `vramMB` is the figure web-llm's own `prebuiltAppConfig`
 * reports.
 *
 * The two diverge a lot, and the difference matters here. Download is what a
 * visitor pays for on their connection; VRAM is what decides whether the model
 * runs at all on a phone. A model can be half the download and twice the VRAM,
 * which is exactly the Qwen3 case below.
 *
 * Measured 2026-08-20 against @mlc-ai/web-llm 0.2.84.
 */
export type BrowserModel = {
  id: string;
  label: string;
  downloadMB: number;
  vramMB: number;
  released: string;
  note: string;
  /**
   * The two window sizes from the model's own `mlc-chat-config.json`, recorded
   * so the invariant below can be checked without a network call.
   *
   * web-llm's `prebuiltAppConfig` overrides `context_window_size` to 4096 for
   * every model here. The runtime rejects `context_window_size` and
   * `sliding_window_size` both being positive, so any model shipping a positive
   * sliding window cannot start under that override. `scripts/verify-models.mts`
   * re-checks these numbers against Hugging Face in CI, because they are facts
   * about someone else's repository and can change without us.
   */
  config: { contextWindowSize: number; slidingWindowSize: number };
  /**
   * Set when web-llm cannot actually start this model, with the reason. Size
   * and recency are easy to compare and turned out not to be sufficient: a
   * model can win on every published number and still refuse to initialise.
   */
  broken?: string;
};

/** What `prebuiltAppConfig` forces for every model in this list. */
export const WEBLLM_CONTEXT_OVERRIDE = 4096;

/**
 * The context window requested, overriding web-llm's 4096.
 *
 * 4096 did not fit. The prompt measured 5,638 tokens on the first turn and
 * 7,215 in the worst case, so no local model could author anything — not
 * because of its size, but because the request never fit at all. The failure
 * was invisible: the model loaded, reported ready, and every answer quietly
 * came from the server.
 *
 * Most of that was one mistake, since fixed (see `describeVocabulary`). The
 * reachable worst case is now ~5,200 tokens, measured pessimistically at three
 * characters per token.
 *
 * 8192 would fit it, but at 89% occupancy — too thin, since capsules and READMEs
 * both grow without anyone touching this file. 12288 leaves real headroom.
 *
 * The cost is KV cache. For Llama 3.2 1B (16 layers, 8 KV heads, head dim 64,
 * fp16) that is 2 x 16 x 8 x 64 x 2 = 32 KB per token, so 12288 tokens is about
 * 384 MB against 128 MB at 4096 — roughly 1.1 GB of VRAM in total rather than
 * the 879 MB recorded below. That figure is arithmetic, not a measurement; no
 * environment here has a GPU to confirm it on.
 *
 * `lib/ui/prompt.test.ts` holds the prompt and the window together, so a prompt
 * that outgrows the window fails a test instead of a browser.
 */
export const REQUESTED_CONTEXT = 12288;

/** Tokens held back for the model's reply when checking the prompt budget. */
export const OUTPUT_RESERVE = 2048;

/**
 * Whether web-llm can start this model at all.
 *
 * This is the check that was missing. It is arithmetic on two recorded numbers,
 * it costs nothing, and it would have rejected the Gemma 3 default before it
 * ever reached a browser.
 */
export function hasWindowConflict(model: BrowserModel) {
  return WEBLLM_CONTEXT_OVERRIDE > 0 && model.config.slidingWindowSize > 0;
}

/**
 * Whether the model was trained far enough to serve this app's prompt.
 *
 * Requesting more context than a model natively supports is not a tuning knob,
 * it is a broken configuration — so a model below `REQUESTED_CONTEXT` is not a
 * candidate at all, however cheap it is. SmolLM2 360M stops here.
 */
export function fitsRequestedContext(model: BrowserModel) {
  return model.config.contextWindowSize >= REQUESTED_CONTEXT;
}

export const BROWSER_MODELS: BrowserModel[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    config: { contextWindowSize: 131072, slidingWindowSize: -1 },
    label: "Llama 3.2 1B",
    downloadMB: 672,
    vramMB: 879,
    released: "2024-09",
    note: "The default. Twice the download of Qwen3 0.6B, and older, but a full billion parameters — chosen deliberately for that, because authoring a typed transaction is the hard part here and the grammar that would have covered a smaller model is broken in this version of web-llm.",
  },
  {
    id: "Qwen3-0.6B-q4f16_1-MLC",
    config: { contextWindowSize: 40960, slidingWindowSize: -1 },
    label: "Qwen3 0.6B",
    downloadMB: 335,
    vramMB: 1403,
    released: "2025-04",
    note: "The fallback, and the smallest download here that is worth trying. Newest of the set, but 0.6B parameters proved thin for authoring a valid Δ without a grammar to hold the JSON together.",
  },
  {
    id: "gemma3-1b-it-q4f16_1-MLC",
    config: { contextWindowSize: 8192, slidingWindowSize: 512 },
    label: "Gemma 3 1B",
    downloadMB: 574,
    vramMB: 711,
    released: "2025-03",
    broken:
      "web-llm 0.2.84 cannot start it. The model ships sliding_window_size: 512 in its own mlc-chat-config.json, and prebuiltAppConfig then overrides context_window_size to 4096 without clearing the sliding window; the runtime rejects both being positive. Every other model here ships sliding_window_size: -1, so the same override is harmless for them. Recheck when web-llm updates.",
    note: "On published numbers it wins on all three axes against Llama 3.2 1B — newer, 98 MB smaller, 168 MB less VRAM — which is exactly why it was picked, and exactly why size and recency are not enough on their own.",
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    config: { contextWindowSize: 32768, slidingWindowSize: -1 },
    label: "Qwen2.5 0.5B",
    downloadMB: 276,
    vramMB: 945,
    released: "2024-09",
    note: "Cheap to fetch, but half a billion parameters is thin for choosing components and inventing ids, even with the grammar holding the JSON together.",
  },
  {
    id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    config: { contextWindowSize: 8192, slidingWindowSize: -1 },
    label: "SmolLM2 360M",
    downloadMB: 198,
    vramMB: 376,
    released: "2024-10",
    note: "The floor: smallest on both axes. Its native 8,192-token window is below what this app asks for, so it is not a candidate — kept as the lower bound of what the ecosystem offers.",
  },
];

const usable = BROWSER_MODELS.filter(
  (model) => !model.broken && !hasWindowConflict(model) && fitsRequestedContext(model),
);

/** First choice. */
export const DEFAULT_MODEL = usable[0];

/**
 * Tried once if the default fails to initialise.
 *
 * A model that cannot start is not a rare event — it took one wrong default to
 * find one — and the difference between "slower answers" and "no local model"
 * is worth one retry.
 */
export const FALLBACK_MODEL = usable[1];
