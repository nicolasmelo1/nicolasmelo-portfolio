import type { Spec } from "@json-render/core";
import { z } from "zod";
import { applyOps, opSchema, type Op } from "@/lib/runtime/ops";

/**
 * The effect journal.
 *
 * A Δ is one user intent turned into ops. The journal keeps, per Δ, both the
 * ops and the inverse the kernel derived when it applied them, so travelling
 * back is running inverses in LIFO order rather than rebuilding a document.
 *
 * `cursor` is the checkpoint: the number of Δ currently applied. It is cheap in
 * exactly the way the paper's accumulator is cheap — a position in a journal
 * plus the active set, never a snapshot of the whole workspace.
 *
 * Everything in this module is the recovery layer. The model proposes Δ; it
 * does not get to edit how Δ are reverted. Keeping that separation is the whole
 * reason an exploratory author can be allowed to fail repeatedly.
 */

export const deltaSchema = z.object({
  label: z.string().min(1).max(48),
  ops: z.array(opSchema).min(1),
});

/**
 * Who authored a Δ. `deterministic` is the server's fallback author, which has
 * the repository read; `offline` is the browser's last resort, which does not.
 * Keeping them apart matters — conflating them hid a control-flow bug where
 * every local-model failure silently produced the weaker answer.
 */
export type Source = "local" | "cloud" | "deterministic" | "offline";

export type Delta = {
  id: string;
  label: string;
  query: string;
  source: Source;
  ops: Op[];
};

type Entry = { delta: Delta; inverse: Op[] };

export type Timeline = {
  /** S₀ — the state every path can return to. */
  base: Spec;
  current: Spec;
  entries: Entry[];
  /** How many entries are applied. `entries.length - cursor` are ahead of us. */
  cursor: number;
  /** Δ sequences abandoned by committing over a rewound cursor. */
  discarded: Delta[][];
};

export function createTimeline(base: Spec): Timeline {
  return { base, current: base, entries: [], cursor: 0, discarded: [] };
}

export function canGoBack(timeline: Timeline) {
  return timeline.cursor > 0;
}

export function canGoForward(timeline: Timeline) {
  return timeline.cursor < timeline.entries.length;
}

/** The Δ that produced the state on screen, if any. */
export function head(timeline: Timeline): Delta | null {
  return timeline.cursor > 0 ? timeline.entries[timeline.cursor - 1].delta : null;
}

/**
 * Apply a Δ at the cursor.
 *
 * Committing while rewound abandons whatever was ahead. Those Δ are not
 * replayed and not merged; their inverses have already run, so the workspace
 * carries nothing from them. That is the property that lets the model try,
 * fail, rewind and try again without the document accumulating residue.
 */
export function commit(timeline: Timeline, delta: Delta): Timeline {
  const ahead = timeline.entries.slice(timeline.cursor);
  const { next, inverse } = applyOps(timeline.current, delta.ops);
  return {
    base: timeline.base,
    current: next,
    entries: [...timeline.entries.slice(0, timeline.cursor), { delta, inverse }],
    cursor: timeline.cursor + 1,
    discarded: ahead.length ? [...timeline.discarded, ahead.map((e) => e.delta)] : timeline.discarded,
  };
}

/**
 * Apply a Δ, or refuse it.
 *
 * `commit` throws when a Δ is not applicable — a node attached before it was
 * registered, a parent that does not exist — which is correct for a kernel and
 * fatal for a caller. A Δ authored by a model is untrusted input, and one that
 * attached `d1-palmares-summary` without registering it took the whole page down
 * from inside a React state updater.
 *
 * Every entry point outside this module uses this instead, and
 * `L0.TIMELINE_IS_ENTERED_THROUGH_THE_CHECKED_COMMIT` keeps it that way.
 */
export function commitChecked(timeline: Timeline, delta: Delta): Timeline | null {
  try {
    return commit(timeline, delta);
  } catch {
    return null;
  }
}

/**
 * Replace the Δ at the cursor with a better one.
 *
 * Superseding is not abandoning. A provisional answer that a model then
 * improves on is one intent with two authors, so the entry is replaced rather
 * than rewound-and-recommitted: the journal keeps one Δ per question, and the
 * discarded-branch count stays reserved for what it means — an experiment the
 * visitor walked away from.
 *
 * Returns null if there is nothing at the cursor, or if the replacement does
 * not apply to the state the original was applied to.
 */
export function replaceHead(timeline: Timeline, delta: Delta): Timeline | null {
  if (!canGoBack(timeline)) return null;

  const entry = timeline.entries[timeline.cursor - 1];
  let rolledBack: Spec;
  try {
    rolledBack = applyOps(timeline.current, entry.inverse).next;
  } catch {
    return null;
  }

  const withoutHead: Timeline = {
    ...timeline,
    current: rolledBack,
    entries: timeline.entries.slice(0, timeline.cursor - 1),
    cursor: timeline.cursor - 1,
  };
  return commitChecked(withoutHead, delta);
}

/** Undo the Δ at the cursor by running its recorded inverse. */
export function back(timeline: Timeline): Timeline {
  if (!canGoBack(timeline)) return timeline;
  const entry = timeline.entries[timeline.cursor - 1];
  const { next } = applyOps(timeline.current, entry.inverse);
  return { ...timeline, current: next, cursor: timeline.cursor - 1 };
}

/**
 * Redo the next Δ. The inverse is recomputed rather than reused, because an
 * inverse is only witnessed at the state where its effect was applied.
 */
export function forward(timeline: Timeline): Timeline {
  if (!canGoForward(timeline)) return timeline;
  const entry = timeline.entries[timeline.cursor];
  const { next, inverse } = applyOps(timeline.current, entry.delta.ops);
  const entries = [...timeline.entries];
  entries[timeline.cursor] = { delta: entry.delta, inverse };
  return { ...timeline, current: next, entries, cursor: timeline.cursor + 1 };
}

/** Rewind to a checkpoint — any cursor position, in one step. */
export function rewindTo(timeline: Timeline, cursor: number): Timeline {
  let next = timeline;
  const target = Math.max(0, Math.min(cursor, timeline.entries.length));
  while (next.cursor > target) next = back(next);
  while (next.cursor < target) next = forward(next);
  return next;
}

/** Discard everything and return to S₀. */
export function reset(timeline: Timeline): Timeline {
  return createTimeline(timeline.base);
}

/**
 * Replay the active Δ onto the base from scratch.
 *
 * This exists to be compared against `current`. The paper's confluence result
 * says the state reached by any interleaving of loads and unloads equals the
 * state a fresh run of the surviving components would produce; here that claim
 * is checkable, and `lib/runtime/timeline.test.ts` checks it against random
 * walks rather than trusting it.
 */
export function replay(timeline: Timeline): Spec {
  const active = timeline.entries.slice(0, timeline.cursor);
  let spec = timeline.base;
  for (const entry of active) {
    spec = applyOps(spec, entry.delta.ops).next;
  }
  return spec;
}
