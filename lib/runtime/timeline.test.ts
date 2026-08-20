import type { Spec } from "@json-render/core";
import { describe, expect, it } from "vitest";
import { applyOp, applyOps, OpError, type Op } from "@/lib/runtime/ops";
import {
  back,
  canGoBack,
  canGoForward,
  commit,
  createTimeline,
  forward,
  head,
  replay,
  reset,
  rewindTo,
  type Delta,
  type Timeline,
} from "@/lib/runtime/timeline";

const base: Spec = {
  root: "page",
  elements: {
    page: { type: "Canvas", props: {}, children: ["intro"] },
    intro: { type: "Text", props: { text: "hello" }, children: [] },
  },
};

function node(type = "Text", props: Record<string, unknown> = {}) {
  return { type, props, children: [] };
}

function delta(id: string, ops: Op[]): Delta {
  return { id, label: id, query: id, source: "deterministic", ops };
}

const addCard = (id: string): Op[] => [
  { kind: "register", id, node: node("Card", { title: id }) },
  { kind: "attach", parent: "page", child: id },
];

describe("applyOp — every op is exactly invertible", () => {
  const cases: Array<[string, Op]> = [
    ["register (new)", { kind: "register", id: "fresh", node: node() }],
    ["register (replacing)", { kind: "register", id: "intro", node: node("Card") }],
    ["unregister", { kind: "unregister", id: "intro" }],
    ["attach", { kind: "attach", parent: "intro", child: "page" }],
    ["detach", { kind: "detach", parent: "page", child: "intro" }],
    ["setRoot", { kind: "setRoot", id: "intro" }],
    ["patchProps (existing key)", { kind: "patchProps", id: "intro", props: { text: "bye" } }],
    ["patchProps (new key)", { kind: "patchProps", id: "intro", props: { tone: "loud" } }],
    ["dropProps", { kind: "dropProps", id: "intro", keys: ["text"] }],
  ];

  for (const [name, op] of cases) {
    it(`${name} round-trips to the original state`, () => {
      const { next, inverse } = applyOp(base, op);
      expect(next).not.toEqual(base);
      expect(applyOps(next, inverse).next).toEqual(base);
    });
  }

  it("restores a child at the index it was detached from", () => {
    let spec = base;
    for (const id of ["a", "b", "c"]) {
      spec = applyOps(spec, addCard(id)).next;
    }
    const before = spec.elements.page.children;
    const { next, inverse } = applyOp(spec, { kind: "detach", parent: "page", child: "b" });
    expect(next.elements.page.children).toEqual(["intro", "a", "c"]);
    expect(applyOps(next, inverse).next.elements.page.children).toEqual(before);
  });

  it("unregistering detaches from every parent and undo re-attaches all of them", () => {
    let spec = applyOps(base, addCard("shared")).next;
    spec = applyOps(spec, [
      { kind: "register", id: "other", node: node("Card") },
      { kind: "attach", parent: "other", child: "shared" },
      { kind: "attach", parent: "page", child: "other" },
    ]).next;

    const { next, inverse } = applyOp(spec, { kind: "unregister", id: "shared" });
    expect(next.elements.shared).toBeUndefined();
    expect(next.elements.page.children).not.toContain("shared");
    expect(next.elements.other.children).not.toContain("shared");
    expect(applyOps(next, inverse).next).toEqual(spec);
  });

  it("refuses ops that do not make sense", () => {
    expect(() => applyOp(base, { kind: "unregister", id: "page" })).toThrow(OpError);
    expect(() => applyOp(base, { kind: "unregister", id: "ghost" })).toThrow(OpError);
    expect(() => applyOp(base, { kind: "attach", parent: "page", child: "ghost" })).toThrow(OpError);
    expect(() => applyOp(base, { kind: "attach", parent: "page", child: "intro" })).toThrow(OpError);
    expect(() => applyOp(base, { kind: "detach", parent: "page", child: "ghost" })).toThrow(OpError);
    expect(() => applyOp(base, { kind: "setRoot", id: "ghost" })).toThrow(OpError);
  });
});

describe("timeline — travel there and back", () => {
  it("starts at S₀ with nowhere to go", () => {
    const t = createTimeline(base);
    expect(t.current).toEqual(base);
    expect(canGoBack(t)).toBe(false);
    expect(canGoForward(t)).toBe(false);
    expect(head(t)).toBeNull();
  });

  it("a committed Δ can be walked back to exactly S₀", () => {
    const t = commit(createTimeline(base), delta("kanban", addCard("kanban")));
    expect(t.current.elements.kanban).toBeDefined();
    expect(canGoBack(t)).toBe(true);

    const backAgain = back(t);
    expect(backAgain.current).toEqual(base);
    expect(canGoForward(backAgain)).toBe(true);
    expect(head(backAgain)).toBeNull();
  });

  it("forward re-applies the Δ it undid", () => {
    const one = commit(createTimeline(base), delta("table", addCard("table")));
    const there = forward(back(one));
    expect(there.current).toEqual(one.current);
    expect(there.cursor).toBe(1);
  });

  it("back and forward over many Δ land on the same states", () => {
    let t = createTimeline(base);
    const seen: Spec[] = [t.current];
    for (const id of ["one", "two", "three"]) {
      t = commit(t, delta(id, addCard(id)));
      seen.push(t.current);
    }
    for (let i = seen.length - 1; i > 0; i -= 1) {
      expect(t.current).toEqual(seen[i]);
      t = back(t);
    }
    expect(t.current).toEqual(base);
    for (let i = 1; i < seen.length; i += 1) {
      t = forward(t);
      expect(t.current).toEqual(seen[i]);
    }
  });

  it("rewinds to an arbitrary checkpoint in one call", () => {
    let t = createTimeline(base);
    for (const id of ["a", "b", "c", "d"]) t = commit(t, delta(id, addCard(id)));
    const at2 = rewindTo(t, 2);
    expect(at2.cursor).toBe(2);
    expect(at2.current.elements.b).toBeDefined();
    expect(at2.current.elements.c).toBeUndefined();
    expect(rewindTo(at2, 4).current).toEqual(t.current);
  });

  it("reset returns to S₀ and forgets the journal", () => {
    let t = createTimeline(base);
    for (const id of ["a", "b"]) t = commit(t, delta(id, addCard(id)));
    const fresh = reset(t);
    expect(fresh.current).toEqual(base);
    expect(fresh.entries).toHaveLength(0);
    expect(canGoForward(fresh)).toBe(false);
  });
});

describe("timeline — abandoned branches leave no residue", () => {
  it("committing over a rewound cursor drops the branch entirely", () => {
    const s0 = createTimeline(base);
    const kanban = commit(s0, delta("kanban", addCard("kanban")));
    const rewound = back(kanban);
    const table = commit(rewound, delta("table", addCard("table")));

    expect(table.current.elements.table).toBeDefined();
    expect(table.current.elements.kanban).toBeUndefined();
    expect(table.current.elements.page.children).not.toContain("kanban");
    expect(table.discarded).toEqual([[kanban.entries[0].delta]]);
    expect(canGoForward(table)).toBe(false);
  });

  it("three rejected experiments from one checkpoint leave the winner alone", () => {
    const s1 = commit(createTimeline(base), delta("board", addCard("board")));

    let t = s1;
    for (const experiment of ["compact", "list", "dense"]) {
      t = commit(t, delta(experiment, addCard(experiment)));
      t = back(t);
    }
    const winner = commit(t, delta("dense-table", addCard("dense-table")));

    expect(winner.current.elements["dense-table"]).toBeDefined();
    expect(winner.current.elements.board).toBeDefined();
    for (const rejected of ["compact", "list", "dense"]) {
      expect(winner.current.elements[rejected]).toBeUndefined();
    }
    // The surviving document is what a fresh run of the survivors would build.
    expect(winner.current).toEqual(replay(winner));
  });
});

describe("timeline — confluence", () => {
  // A seeded walk rather than Math.random, so a failure is reproducible.
  function lcg(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  it("any interleaving of commit, back and forward agrees with a fresh replay", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = lcg(seed);
      let t: Timeline = createTimeline(base);
      let minted = 0;

      for (let step = 0; step < 60; step += 1) {
        const roll = random();
        if (roll < 0.45) {
          minted += 1;
          const id = `n${seed}x${minted}`;
          t = commit(t, delta(id, addCard(id)));
        } else if (roll < 0.75) {
          t = back(t);
        } else {
          t = forward(t);
        }

        // The invariant under test, checked at every single step.
        expect(t.current).toEqual(replay(t));
      }

      // And walking all the way back must land exactly on S₀, no residue.
      let unwound = t;
      while (canGoBack(unwound)) unwound = back(unwound);
      expect(unwound.current).toEqual(base);
    }
  });

  it("a Δ that mixes every op kind still unwinds to S₀", () => {
    const mixed: Op[] = [
      { kind: "register", id: "wrap", node: node("Card", { title: "t", note: "n" }) },
      { kind: "attach", parent: "page", child: "wrap", index: 0 },
      { kind: "detach", parent: "page", child: "intro" },
      { kind: "attach", parent: "wrap", child: "intro" },
      { kind: "patchProps", id: "intro", props: { text: "moved", extra: 1 } },
      { kind: "dropProps", id: "wrap", keys: ["note"] },
      { kind: "setRoot", id: "wrap" },
    ];
    const t = commit(createTimeline(base), delta("restructure", mixed));
    expect(t.current.root).toBe("wrap");
    expect(back(t).current).toEqual(base);
  });
});
