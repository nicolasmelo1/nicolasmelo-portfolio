import { describe, expect, it } from "vitest";
import {
  BROWSER_MODELS,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  fitsRequestedContext,
  hasWindowConflict,
  REQUESTED_CONTEXT,
  WEBLLM_CONTEXT_OVERRIDE,
} from "@/lib/llm/models";

const byId = (id: string) => BROWSER_MODELS.find((m) => m.id === id)!;

describe("the browser model registry", () => {
  it("has no duplicate ids and explains every entry", () => {
    expect(new Set(BROWSER_MODELS.map((m) => m.id)).size).toBe(BROWSER_MODELS.length);
    for (const model of BROWSER_MODELS) {
      expect(model.note.length, model.id).toBeGreaterThan(20);
      expect(model.released, model.id).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("keeps download and VRAM as separate numbers", () => {
    // Conflating them is how the copy came to advertise a VRAM figure as a
    // download size. They differ for every entry here.
    for (const model of BROWSER_MODELS) {
      expect(model.downloadMB, model.id).not.toEqual(model.vramMB);
      expect(model.downloadMB, model.id).toBeGreaterThan(0);
      expect(model.vramMB, model.id).toBeGreaterThan(0);
    }
  });

  it("records both window sizes for every model", () => {
    // The recorded pair is what makes the conflict checkable offline. An entry
    // added without it cannot be reasoned about at all.
    for (const model of BROWSER_MODELS) {
      expect(typeof model.config.contextWindowSize, model.id).toBe("number");
      expect(typeof model.config.slidingWindowSize, model.id).toBe("number");
      expect(model.config.contextWindowSize, model.id).not.toBe(0);
      expect(model.config.slidingWindowSize, model.id).not.toBe(0);
    }
  });
});

describe("the window-size conflict that killed the last default", () => {
  it("is what `hasWindowConflict` computes", () => {
    expect(WEBLLM_CONTEXT_OVERRIDE).toBeGreaterThan(0);
    for (const model of BROWSER_MODELS) {
      expect(hasWindowConflict(model), model.id).toBe(model.config.slidingWindowSize > 0);
    }
  });

  it("catches Gemma 3 1B, which web-llm cannot start", () => {
    const gemma = byId("gemma3-1b-it-q4f16_1-MLC");
    expect(gemma.config.slidingWindowSize).toBe(512);
    expect(hasWindowConflict(gemma)).toBe(true);
    // And the reason is written down, not just the verdict.
    expect(gemma.broken).toMatch(/sliding_window_size/);
  });

  it("never selects a conflicting model, however good its numbers look", () => {
    // Gemma 3 1B beats the chosen default on download and on VRAM and is newer
    // than the fallback. Selection has to ignore all of that.
    const gemma = byId("gemma3-1b-it-q4f16_1-MLC");
    expect(gemma.downloadMB).toBeLessThan(byId("Llama-3.2-1B-Instruct-q4f16_1-MLC").downloadMB);
    expect(gemma.vramMB).toBeLessThan(DEFAULT_MODEL.vramMB);

    expect(DEFAULT_MODEL.id).not.toBe(gemma.id);
    expect(FALLBACK_MODEL.id).not.toBe(gemma.id);
  });
});

describe("selection", () => {
  it("picks a default that can actually start", () => {
    expect(DEFAULT_MODEL).toBeDefined();
    expect(hasWindowConflict(DEFAULT_MODEL)).toBe(false);
    expect(DEFAULT_MODEL.broken).toBeUndefined();
  });

  it("has a distinct fallback that can also start", () => {
    expect(FALLBACK_MODEL).toBeDefined();
    expect(FALLBACK_MODEL.id).not.toBe(DEFAULT_MODEL.id);
    expect(hasWindowConflict(FALLBACK_MODEL)).toBe(false);
    expect(FALLBACK_MODEL.broken).toBeUndefined();
  });

  // The criterion is no longer "newest and smallest". It was, and it produced a
  // default that could not author a transaction: 0.6B parameters were thin for
  // the job once grammar-constrained decoding turned out to be broken in this
  // version of web-llm. Capability wins over both size and recency, and the
  // fallback is the cheap one.
  it("does not default to the smallest or the newest, deliberately", () => {
    const usable = BROWSER_MODELS.filter((m) => !m.broken && !hasWindowConflict(m));
    const smallest = usable.reduce((a, b) => (b.downloadMB < a.downloadMB ? b : a));
    const newest = usable.reduce((a, b) => (b.released > a.released ? b : a));

    expect(DEFAULT_MODEL.id).not.toBe(smallest.id);
    expect(DEFAULT_MODEL.id).not.toBe(newest.id);
    // And the reason is written down where the next person will look.
    expect(DEFAULT_MODEL.note).toMatch(/parameters|grammar/);
  });

  it("falls back to something cheaper than the default", () => {
    // A failed default is usually a resource problem, so retrying with a
    // heavier model would be the wrong move.
    expect(FALLBACK_MODEL.downloadMB).toBeLessThan(DEFAULT_MODEL.downloadMB);
  });

  it("excludes a model whose native window is too small, however cheap", () => {
    // SmolLM2 360M is the smallest thing here on both axes and still not a
    // candidate: 8,192 native against 12,288 requested. Asking a model for more
    // context than it was trained for is a broken configuration, not a knob.
    const smol = byId("SmolLM2-360M-Instruct-q4f16_1-MLC");
    expect(smol.config.contextWindowSize).toBeLessThan(REQUESTED_CONTEXT);
    expect(fitsRequestedContext(smol)).toBe(false);
    expect(DEFAULT_MODEL.id).not.toBe(smol.id);
    expect(FALLBACK_MODEL.id).not.toBe(smol.id);
  });

  it("only selects models whose native context window covers what we request", () => {
    // web-llm's 4096 override is replaced with REQUESTED_CONTEXT, which is only
    // legitimate if the model was trained to go that far.
    for (const model of [DEFAULT_MODEL, FALLBACK_MODEL]) {
      expect(model.config.contextWindowSize, model.id).toBeGreaterThanOrEqual(REQUESTED_CONTEXT);
      expect(fitsRequestedContext(model), model.id).toBe(true);
    }
  });
});
