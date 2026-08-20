/**
 * Check every browser model against the two sources of truth that live outside
 * this repository, and fail loudly when they disagree with what we recorded.
 *
 * This exists because of a specific failure. `gemma3-1b-it` was chosen as the
 * default on published numbers — newer than the model it replaced, smaller to
 * download, less VRAM — and it could not start at all: it ships
 * `sliding_window_size: 512`, web-llm's `prebuiltAppConfig` overrides
 * `context_window_size` to 4096, and the runtime rejects both being positive.
 * Nothing in the type system, the tests or the build could see that, because
 * both halves of the conflict live in someone else's package and someone else's
 * Hugging Face repository. Only a fetch can see it.
 *
 * Run: npm run verify:models
 */
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import {
  BROWSER_MODELS,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  hasWindowConflict,
  REQUESTED_CONTEXT,
  WEBLLM_CONTEXT_OVERRIDE,
  type BrowserModel,
} from "../lib/llm/models.ts";

type HfConfig = { context_window_size?: number; sliding_window_size?: number };

const problems: string[] = [];
const note = (message: string) => problems.push(message);

async function hfConfig(id: string): Promise<HfConfig | null> {
  const url = `https://huggingface.co/mlc-ai/${id}/raw/main/mlc-chat-config.json`;
  const response = await fetch(url);
  if (!response.ok) {
    note(`${id}: mlc-chat-config.json returned ${response.status} from ${url}`);
    return null;
  }
  return (await response.json()) as HfConfig;
}

function checkAgainstWebLLM(model: BrowserModel) {
  const entry = prebuiltAppConfig.model_list.find((m) => m.model_id === model.id);
  if (!entry) {
    note(`${model.id}: not in web-llm's prebuiltAppConfig — it cannot be loaded at all`);
    return;
  }
  const override = entry.overrides?.context_window_size;
  if (override !== WEBLLM_CONTEXT_OVERRIDE) {
    note(
      `${model.id}: web-llm overrides context_window_size to ${override}, but models.ts ` +
        `assumes ${WEBLLM_CONTEXT_OVERRIDE}. The conflict rule is derived from that number, ` +
        `so update WEBLLM_CONTEXT_OVERRIDE and re-derive.`,
    );
  }
}

/** Recorded numbers versus what Hugging Face serves now. */
function checkRecordedNumbers(model: BrowserModel, actual: BrowserModel["config"]) {
  for (const key of ["contextWindowSize", "slidingWindowSize"] as const) {
    if (actual[key] !== model.config[key]) {
      note(
        `${model.id}: recorded ${key} is ${model.config[key]} but Hugging Face now says ` +
          `${actual[key]}. Update lib/llm/models.ts.`,
      );
    }
  }
}

/** The conflict that made a model unable to start, computed from live data. */
function checkWindowConflict(model: BrowserModel, actual: BrowserModel["config"]) {
  const conflicts = WEBLLM_CONTEXT_OVERRIDE > 0 && actual.slidingWindowSize > 0;

  if (conflicts && !model.broken) {
    note(
      `${model.id}: WOULD FAIL AT RUNTIME. sliding_window_size is ${actual.slidingWindowSize} ` +
        `and web-llm forces context_window_size to ${WEBLLM_CONTEXT_OVERRIDE}; the runtime ` +
        `rejects both being positive. Mark it \`broken\` or stop listing it.`,
    );
  }
  if (!conflicts && model.broken?.includes("sliding_window_size")) {
    note(
      `${model.id}: marked broken over a sliding-window conflict that no longer exists ` +
        `(sliding_window_size is now ${actual.slidingWindowSize}). Re-test and unmark it.`,
    );
  }
  if (conflicts !== hasWindowConflict(model)) {
    note(
      `${model.id}: hasWindowConflict() says ${hasWindowConflict(model)} but the live config ` +
        `says ${conflicts}. The recorded numbers are stale.`,
    );
  }
}

/**
 * Whether the model can carry the window this app requests.
 *
 * Only a drift matters: a model recorded as too small is a deliberate
 * exclusion, while one recorded as big enough that is not is a stale number the
 * selection logic is trusting.
 */
function checkRequestedWindow(model: BrowserModel, actual: BrowserModel["config"]) {
  const recordedFits = model.config.contextWindowSize >= REQUESTED_CONTEXT;
  const actuallyFits = actual.contextWindowSize >= REQUESTED_CONTEXT;

  if (recordedFits && !actuallyFits) {
    note(
      `${model.id}: recorded context_window_size covers the requested ${REQUESTED_CONTEXT}, but ` +
        `Hugging Face now says ${actual.contextWindowSize}. Selection is trusting a stale number.`,
    );
  }
  if (!actuallyFits && (model.id === DEFAULT_MODEL?.id || model.id === FALLBACK_MODEL?.id)) {
    note(
      `${model.id} is selected but its native context_window_size is ${actual.contextWindowSize}, ` +
        `below the requested ${REQUESTED_CONTEXT}.`,
    );
  }
}

function checkAgainstHuggingFace(model: BrowserModel, config: HfConfig) {
  const actual = {
    contextWindowSize: config.context_window_size ?? -1,
    slidingWindowSize: config.sliding_window_size ?? -1,
  };
  checkRecordedNumbers(model, actual);
  checkWindowConflict(model, actual);
  checkRequestedWindow(model, actual);
}

async function main() {
  if (!DEFAULT_MODEL) note("no usable default model: every entry is broken or conflicting");
  if (!FALLBACK_MODEL) note("no usable fallback model: a failed default has nothing to fall back to");
  if (DEFAULT_MODEL && hasWindowConflict(DEFAULT_MODEL)) {
    note(`the default (${DEFAULT_MODEL.id}) has a window conflict and cannot start`);
  }

  for (const model of BROWSER_MODELS) {
    checkAgainstWebLLM(model);
    const config = await hfConfig(model.id);
    if (config) checkAgainstHuggingFace(model, config);
  }

  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s) with the browser model registry:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ ${BROWSER_MODELS.length} models checked against web-llm and Hugging Face; ` +
      `default is ${DEFAULT_MODEL.id}, fallback ${FALLBACK_MODEL.id}`,
  );
}

await main();
