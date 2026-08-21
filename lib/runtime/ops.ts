import type { Spec } from "@json-render/core";
import { z } from "zod";

/**
 * The operation algebra. This is the *only* vocabulary in which the interface
 * can change.
 *
 * Cordis (§3.1) models an effect as a function that yields the new context
 * together with an explicit inverse — the type it calls `E*`. Everything below
 * is that idea made concrete for a UI: `apply` returns the next workspace and
 * the ops that undo it. Because the inverse is computed against the state the
 * op was applied to, undo is exact rather than approximate, which is what makes
 * a Δ removable from the middle of a session without leaving residue.
 *
 * The model never writes code and never writes a whole document. It proposes
 * ops, validated here, and the kernel decides what they invert to. That
 * asymmetry is deliberate: a probabilistic author may propose any change it
 * likes, but it cannot author the mechanism that takes the change back.
 */

const uiNodeSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).default([]),
});

export const opSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("register"), id: z.string().min(1), node: uiNodeSchema }),
  z.object({ kind: z.literal("unregister"), id: z.string().min(1) }),
  z.object({
    kind: z.literal("attach"),
    parent: z.string().min(1),
    child: z.string().min(1),
    index: z.number().int().min(0).optional(),
  }),
  z.object({ kind: z.literal("detach"), parent: z.string().min(1), child: z.string().min(1) }),
  z.object({ kind: z.literal("setRoot"), id: z.string().min(1) }),
  z.object({
    kind: z.literal("patchProps"),
    id: z.string().min(1),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("dropProps"),
    id: z.string().min(1),
    keys: z.array(z.string().min(1)),
  }),
]);

export type Op = z.infer<typeof opSchema>;
type UINode = z.infer<typeof uiNodeSchema>;

export class OpError extends Error {}

type Elements = Spec["elements"];

function elementsWith(elements: Elements, id: string, node: UINode | null): Elements {
  const next: Elements = {};
  for (const [key, value] of Object.entries(elements)) {
    if (key !== id) next[key] = value;
  }
  if (node) next[id] = node as Elements[string];
  return next;
}

function nodeOf(spec: Spec, id: string): UINode {
  const node = spec.elements[id];
  if (!node) throw new OpError(`no element \`${id}\``);
  return node as UINode;
}

type Result = { next: Spec; inverse: Op[] };
type OpOf<K extends Op["kind"]> = Extract<Op, { kind: K }>;

function applyRegister(spec: Spec, op: OpOf<"register">): Result {
  const previous = spec.elements[op.id] as UINode | undefined;
  const next = { ...spec, elements: elementsWith(spec.elements, op.id, op.node) };
  // Registering over an existing id is a replacement, so its inverse puts the
  // old node back rather than deleting the id outright.
  const inverse: Op[] = previous
    ? [{ kind: "register", id: op.id, node: previous }]
    : [{ kind: "unregister", id: op.id }];
  return { next, inverse };
}

function applyUnregister(spec: Spec, op: OpOf<"unregister">): Result {
  const previous = nodeOf(spec, op.id);
  if (spec.root === op.id) throw new OpError(`cannot unregister the root \`${op.id}\``);

  const parents = Object.entries(spec.elements).filter(([, node]) =>
    (node.children ?? []).includes(op.id),
  );

  let next: Spec = { ...spec, elements: elementsWith(spec.elements, op.id, null) };
  const inverse: Op[] = [{ kind: "register", id: op.id, node: previous }];
  for (const [parentId, parent] of parents) {
    const index = (parent.children ?? []).indexOf(op.id);
    next = applyDetach(next, { kind: "detach", parent: parentId, child: op.id }).next;
    inverse.push({ kind: "attach", parent: parentId, child: op.id, index });
  }
  return { next, inverse };
}

function applyAttach(spec: Spec, op: OpOf<"attach">): Result {
  const parent = nodeOf(spec, op.parent);
  nodeOf(spec, op.child);

  const children = [...(parent.children ?? [])];
  if (children.includes(op.child)) {
    throw new OpError(`\`${op.child}\` is already attached to \`${op.parent}\``);
  }
  const at = op.index === undefined ? children.length : Math.min(op.index, children.length);
  children.splice(at, 0, op.child);

  return {
    next: { ...spec, elements: elementsWith(spec.elements, op.parent, { ...parent, children }) },
    inverse: [{ kind: "detach", parent: op.parent, child: op.child }],
  };
}

function applyDetach(spec: Spec, op: OpOf<"detach">): Result {
  const parent = nodeOf(spec, op.parent);
  const children = [...(parent.children ?? [])];
  const index = children.indexOf(op.child);
  if (index === -1) throw new OpError(`\`${op.child}\` is not attached to \`${op.parent}\``);
  children.splice(index, 1);

  return {
    next: { ...spec, elements: elementsWith(spec.elements, op.parent, { ...parent, children }) },
    // The index is what makes undo exact: re-attaching at the end would
    // reorder siblings and quietly change the layout.
    inverse: [{ kind: "attach", parent: op.parent, child: op.child, index }],
  };
}

function applySetRoot(spec: Spec, op: OpOf<"setRoot">): Result {
  nodeOf(spec, op.id);
  return {
    next: { ...spec, root: op.id },
    inverse: [{ kind: "setRoot", id: spec.root }],
  };
}

function applyPatchProps(spec: Spec, op: OpOf<"patchProps">): Result {
  const node = nodeOf(spec, op.id);
  const before = (node.props ?? {}) as Record<string, unknown>;

  // Only the touched keys are restored, and a key that was absent goes back to
  // absent rather than to undefined.
  const restored: Record<string, unknown> = {};
  for (const key of Object.keys(op.props)) {
    if (key in before) restored[key] = before[key];
  }
  const added = Object.keys(op.props).filter((key) => !(key in before));

  return {
    next: {
      ...spec,
      elements: elementsWith(spec.elements, op.id, {
        ...node,
        props: { ...before, ...op.props },
      }),
    },
    inverse: [
      ...(added.length ? [{ kind: "dropProps" as const, id: op.id, keys: added }] : []),
      { kind: "patchProps" as const, id: op.id, props: restored },
    ],
  };
}

function applyDropProps(spec: Spec, op: OpOf<"dropProps">): Result {
  const node = nodeOf(spec, op.id);
  const before = (node.props ?? {}) as Record<string, unknown>;

  const props: Record<string, unknown> = {};
  const restored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(before)) {
    if (op.keys.includes(key)) restored[key] = value;
    else props[key] = value;
  }

  return {
    next: { ...spec, elements: elementsWith(spec.elements, op.id, { ...node, props }) },
    inverse: [{ kind: "patchProps", id: op.id, props: restored }],
  };
}

/**
 * Apply one op. Returns the next spec and the ops that undo it.
 *
 * The inverse is derived from the state *before* the op ran — the paper's
 * witnessed effect function, where the inverse is only obliged to reverse the
 * effect at the state where it was applied.
 */
export function applyOp(spec: Spec, op: Op): Result {
  switch (op.kind) {
    case "register":
      return applyRegister(spec, op);
    case "unregister":
      return applyUnregister(spec, op);
    case "attach":
      return applyAttach(spec, op);
    case "detach":
      return applyDetach(spec, op);
    case "setRoot":
      return applySetRoot(spec, op);
    case "patchProps":
      return applyPatchProps(spec, op);
    case "dropProps":
      return applyDropProps(spec, op);
  }
}

/**
 * Apply a whole Δ. The inverse is the concatenation of each op's inverse in
 * reverse order — the LIFO recovery of Algorithm 1, where each new inverse is
 * prepended to the accumulator.
 */
export function applyOps(spec: Spec, ops: Op[]): { next: Spec; inverse: Op[] } {
  let next = spec;
  const inverse: Op[] = [];
  for (const op of ops) {
    const step = applyOp(next, op);
    next = step.next;
    inverse.unshift(...step.inverse);
  }
  return { next, inverse };
}

/**
 * Apply what applies, and say what did not.
 *
 * `applyOps` is all-or-nothing, which is right for a journal entry and wrong at
 * the boundary: a model that emits nineteen good ops and one impossible one —
 * `unregister` of the root was the real case — should not lose the whole answer
 * after twenty-five seconds of generation.
 *
 * Skipping is only safe because something downstream checks the finished
 * document. Callers must run the catalog gate on `next`; without that, this is
 * just a way to build an incoherent view quietly.
 */
export function applyApplicable(
  spec: Spec,
  ops: Op[],
): { next: Spec; applied: Op[]; skipped: Op[] } {
  let next = spec;
  const applied: Op[] = [];
  const skipped: Op[] = [];

  for (const op of ops) {
    try {
      next = applyOp(next, op).next;
      applied.push(op);
    } catch {
      skipped.push(op);
    }
  }

  return { next, applied, skipped };
}
