"use client";

import type { Spec } from "@json-render/core";
import { applyOps, type Op } from "@/lib/runtime/ops";

/**
 * Reading the streamed transaction.
 *
 * The route sends newline-delimited JSON, one event per line, because a line is
 * the smallest thing that is unambiguously complete. Lines split across network
 * reads, so the tail of a chunk waits for its newline.
 */
export type StreamEvent =
  | { type: "label"; label: string }
  | { type: "op"; op: Op }
  | { type: "done" }
  | { type: "unavailable"; reason: string }
  | { type: "error"; reason: string };

function parse(line: string): StreamEvent | null {
  try {
    const event = JSON.parse(line) as StreamEvent;
    return typeof event?.type === "string" ? event : null;
  } catch {
    return null;
  }
}

/**
 * Read every event from a streaming response, in order.
 *
 * Resolves when the body ends, whether or not a `done` arrived — a truncated
 * stream is a stream that ended without finishing, and the caller decides what
 * that means. Malformed lines are skipped rather than thrown: one unreadable
 * line should not discard the ops that already applied.
 */
export async function readDeltaStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    carry += decoder.decode(value, { stream: true });

    let newline = carry.indexOf("\n");
    while (newline !== -1) {
      const line = carry.slice(0, newline).trim();
      carry = carry.slice(newline + 1);
      if (line) {
        const event = parse(line);
        if (event) onEvent(event);
      }
      newline = carry.indexOf("\n");
    }
  }

  // A last line with no trailing newline is still a line.
  const tail = carry.trim();
  if (tail) {
    const event = parse(tail);
    if (event) onEvent(event);
  }
}

export type StreamedDelta = {
  label: string | null;
  ops: Op[];
  /** True only if the route said `done`. A truncated stream is not a Δ. */
  finished: boolean;
};

/**
 * Read a streamed transaction, building the document as it arrives.
 *
 * The ops are applied to a copy — staging, never the journal — and reported
 * through `onProgress` so the caller can show the assembly. Nothing is returned
 * as committable unless the route said `done`: a transaction that stopped
 * halfway is not one.
 *
 * `onProgress` is held back until the document has something in it. The base is
 * the state from *before* the provisional answer, so reporting it immediately
 * would flash the previous view back onto the screen.
 */
export async function collectStreamedDelta(
  response: Response,
  from: Spec,
  options: { isStale: () => boolean; onProgress: (spec: Spec) => void },
): Promise<StreamedDelta> {
  let assembling = from;
  const ops: Op[] = [];
  let label: string | null = null;
  let finished = false;

  await readDeltaStream(response, (event) => {
    if (options.isStale()) return;

    if (event.type === "label") {
      label = event.label;
      return;
    }
    if (event.type === "done") {
      finished = true;
      return;
    }
    if (event.type !== "op") return;

    // The route applied this against its own mirror before sending it, so it
    // cannot throw here.
    assembling = applyOps(assembling, [event.op]).next;
    ops.push(event.op);
    if ((assembling.elements[assembling.root]?.children ?? []).length > 0) {
      options.onProgress(assembling);
    }
  });

  return { label, ops, finished };
}
