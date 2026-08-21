import type { Spec } from "@json-render/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFlows,
  flowKey,
  MAX_ENTRIES,
  readFlow,
  TTL_MS,
  writeFlow,
} from "@/lib/llm/cache";
import { applyOps } from "@/lib/runtime/ops";
import type { ValidatedDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

/**
 * What the cache is keyed on, which is the only interesting thing about it.
 *
 * A cache keyed on the question would be worse than none: "put them side by
 * side" is a different answer after the projects than after the employers, and
 * serving one for the other would look like a bug in the model.
 */

const columns: ValidatedDelta = {
  label: "side by side",
  ops: [{ kind: "patchProps", id: "canvas", props: { layout: "columns" } }],
};

/** A document with one panel on it, which is what a first answer produces. */
function withPanel(id: string): Spec {
  return applyOps(initialSpec, [
    { kind: "register", id, node: { type: "Panel", props: { title: id, note: null }, children: [] } },
    { kind: "attach", parent: "canvas", child: id },
  ]).next;
}

beforeEach(() => {
  clearFlows();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the flow is the key", () => {
  it("serves the same question, asked the same way, from the same document", () => {
    const key = flowKey("put them side by side", ["show me your projects"], initialSpec);
    writeFlow(key, columns);

    const again = flowKey("put them side by side", ["show me your projects"], initialSpec);
    expect(again).toBe(key);
    expect(readFlow(again, initialSpec)).toEqual(columns);
  });

  // The case that makes the whole design necessary.
  it("does not serve the same question asked after a different one", () => {
    const projects = flowKey("put them side by side", ["show me your projects"], initialSpec);
    const employers = flowKey("put them side by side", ["where have you worked"], initialSpec);

    expect(employers).not.toBe(projects);
    writeFlow(projects, columns);
    expect(readFlow(employers, initialSpec)).toBeNull();
  });

  it("does not serve an answer written for a different document", () => {
    const onProjects = flowKey("make it compact", [], withPanel("projects-panel"));
    const onRoles = flowKey("make it compact", [], withPanel("roles-panel"));

    expect(onRoles).not.toBe(onProjects);
    writeFlow(onProjects, columns);
    expect(readFlow(onRoles, withPanel("roles-panel"))).toBeNull();
  });

  it("treats punctuation and case as the same question", () => {
    const typed = flowKey("Where do you work?", [], initialSpec);
    const shouted = flowKey("WHERE DO YOU WORK", [], initialSpec);
    expect(shouted).toBe(typed);
  });

  it("does not care how the document was assembled, only what it is", () => {
    // Same document, keys inserted in a different order. `JSON.stringify` alone
    // would fingerprint these differently and miss on every second request.
    const one: Spec = { root: "canvas", elements: { canvas: { type: "Canvas", props: { layout: "stack" }, children: [] } } };
    const other = { elements: { canvas: { children: [], props: { layout: "stack" }, type: "Canvas" } }, root: "canvas" } as Spec;
    expect(flowKey("q", [], other)).toBe(flowKey("q", [], one));
  });

  it("forgets history older than the conversation the prompt carries", () => {
    // The prompt only ever sees the last `HISTORY_LIMIT` turns, so a turn
    // beyond that cannot change the answer and must not change the key.
    const old = ["a", "b", "c", "d", "e", "f", "g"];
    expect(flowKey("q", old, initialSpec)).toBe(flowKey("q", old.slice(1), initialSpec));
  });
});

describe("what it refuses to serve", () => {
  it("reads a miss once the entry is older than its lifetime", () => {
    vi.useFakeTimers();
    const key = flowKey("where do you work", [], initialSpec);
    writeFlow(key, columns);
    expect(readFlow(key, initialSpec)).not.toBeNull();

    vi.advanceTimersByTime(TTL_MS + 1);
    expect(readFlow(key, initialSpec)).toBeNull();
    // Dropped rather than left to be re-checked on every request.
    vi.setSystemTime(Date.now());
    expect(readFlow(key, initialSpec)).toBeNull();
  });

  // A cache is an author, and no author is trusted.
  it("puts what it kept back through the gate", () => {
    const key = flowKey("q", [], initialSpec);
    // Applies to nothing: the node it patches does not exist on this document.
    writeFlow(key, { label: "bad", ops: [{ kind: "patchProps", id: "ghost", props: { title: "x" } }] });
    expect(readFlow(key, initialSpec)).toBeNull();
  });

  it("refuses a transaction that would leave an unrenderable document", () => {
    const key = flowKey("q", [], initialSpec);
    writeFlow(key, {
      label: "invented",
      ops: [
        {
          kind: "register",
          id: "nope",
          node: { type: "WhateverTheModelMade", props: {}, children: [] },
        },
        { kind: "attach", parent: "canvas", child: "nope" },
      ],
    });
    expect(readFlow(key, initialSpec)).toBeNull();
  });
});

describe("what it costs to keep", () => {
  const filler = (i: number) => flowKey(`question ${i}`, [], initialSpec);

  it("stays bounded", () => {
    for (let i = 0; i < MAX_ENTRIES + 20; i += 1) writeFlow(filler(i), columns);

    // The earliest writes are gone, the latest are not.
    expect(readFlow(filler(0), initialSpec)).toBeNull();
    expect(readFlow(filler(MAX_ENTRIES + 19), initialSpec)).not.toBeNull();
  });

  it("drops the least recently used, not the least recently written", () => {
    // A preset that gets asked all day should not be evicted by a run of
    // one-off questions, which is the only reason reading re-inserts.
    const preset = flowKey("where do you work", [], initialSpec);
    writeFlow(preset, columns);
    for (let i = 0; i < MAX_ENTRIES - 1; i += 1) writeFlow(filler(i), columns);

    expect(readFlow(preset, initialSpec)).not.toBeNull();
    writeFlow(filler(MAX_ENTRIES), columns);

    expect(readFlow(preset, initialSpec), "the preset was read, so it stays").not.toBeNull();
    expect(readFlow(filler(0), initialSpec), "the oldest untouched entry goes").toBeNull();
  });
});
