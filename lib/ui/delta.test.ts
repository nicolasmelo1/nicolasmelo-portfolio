import { describe, expect, it } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { applyOps } from "@/lib/runtime/ops";
import { back, commit, createTimeline } from "@/lib/runtime/timeline";
import {
  checkedDeterministicDelta,
  clearViewOps,
  deterministicDelta,
  parseDelta,
  refusalDelta,
  subtreeRemovalOps,
  validateDeltaAgainstSpec,
} from "@/lib/ui/delta";
import { initialSpec, parsePortfolioSpec, ROOT_ID } from "@/lib/ui/spec";
import { retrievePortfolio } from "@/lib/retrieve";

function build(query: string) {
  const capsules = retrievePortfolio(query);
  const delta = deterministicDelta(initialSpec, query, capsules);
  return { delta, next: applyOps(initialSpec, delta.ops).next, capsules };
}

describe("initialSpec", () => {
  it("is a valid, empty document", () => {
    expect(parsePortfolioSpec(initialSpec)).not.toBeNull();
    expect(initialSpec.elements[ROOT_ID].children).toEqual([]);
  });
});

describe("deterministicDelta", () => {
  it("produces a document that validates against the catalog", () => {
    const { next } = build("what have you built");
    expect(parsePortfolioSpec(next)).not.toBeNull();
  });

  it("attaches everything it registers", () => {
    const { delta, next } = build("what have you built");
    const registered = delta.ops.filter((op) => op.kind === "register").map((op) => op.id);
    const attached = new Set(
      Object.values(next.elements).flatMap((node) => node.children ?? []),
    );
    for (const id of registered) {
      expect(attached.has(id), `${id} was registered but never attached`).toBe(true);
    }
  });

  it("collapses more than two matches behind an accordion", () => {
    const many = portfolioCapsules.slice(0, 4);
    const delta = deterministicDelta(initialSpec, "everything", many);
    const next = applyOps(initialSpec, delta.ops).next;
    const types = Object.values(next.elements).map((node) => node.type);
    expect(types).toContain("Accordion");
    expect(types.filter((t) => t === "AccordionItem")).toHaveLength(4);
  });

  it("opens exactly one accordion item", () => {
    const delta = deterministicDelta(initialSpec, "everything", portfolioCapsules.slice(0, 4));
    const next = applyOps(initialSpec, delta.ops).next;
    const open = Object.values(next.elements).filter(
      (node) => node.type === "AccordionItem" && node.props.open === true,
    );
    expect(open).toHaveLength(1);
  });

  it("goes to columns for two matches and stays stacked for one", () => {
    const two = applyOps(
      initialSpec,
      deterministicDelta(initialSpec, "x", portfolioCapsules.slice(0, 2)).ops,
    ).next;
    expect(two.elements[ROOT_ID].props.layout).toBe("columns");

    const one = applyOps(
      initialSpec,
      deterministicDelta(initialSpec, "x", portfolioCapsules.slice(0, 1)).ops,
    ).next;
    expect(one.elements[ROOT_ID].props.layout).toBe("stack");
  });

  it("carries a label short enough to display", () => {
    const { delta } = build("what have you built");
    expect(delta.label.length).toBeGreaterThan(0);
    expect(delta.label.length).toBeLessThanOrEqual(48);
  });

  it("is exactly reversible through the journal", () => {
    const question = "what have you built";
    const t = commit(
      createTimeline(initialSpec),
      { id: "d1", query: question, source: "deterministic", ...build(question).delta },
    );
    expect(t.current).not.toEqual(initialSpec);
    expect(back(t).current).toEqual(initialSpec);
  });

  it("replaces the previous view instead of growing the page", () => {
    const first = build("what have you built");
    const second = deterministicDelta(first.next, "how can I reach you", retrievePortfolio("how can I reach you"));
    const after = applyOps(first.next, second.ops).next;

    // Nothing from the first answer survives, attached or merely registered.
    const firstIds = first.delta.ops.filter((op) => op.kind === "register").map((op) => op.id);
    for (const id of firstIds) {
      expect(after.elements[id], `${id} outlived the view that created it`).toBeUndefined();
    }
    expect(parsePortfolioSpec(after)).not.toBeNull();
  });

  it("leaves no orphan registered after two answers and a walk back", () => {
    const question = "what have you built";
    let t = commit(createTimeline(initialSpec), {
      id: "d1",
      query: question,
      source: "deterministic",
      ...build(question).delta,
    });
    const second = deterministicDelta(t.current, "contact", retrievePortfolio("contact"));
    t = commit(t, { id: "d2", query: "contact", source: "deterministic", ...second });
    expect(back(back(t)).current).toEqual(initialSpec);
  });
});

describe("deterministicDelta with a repository read", () => {
  const insight = {
    slug: "nicolasmelo1/logion",
    description: "registry",
    primaryLanguage: "Python",
    languages: [
      { name: "Python", share: 80 },
      { name: "TypeScript", share: 20 },
    ],
    topics: ["agents"],
    stars: 35,
    license: "MIT",
    createdAt: "2026-05-13",
    lastPush: "2026-08-20",
    structure: ["src/", "docs/", "README.md"],
    readmeSections: ["What it is", "Install"],
  };

  function build() {
    const capsule = portfolioCapsules.find((c) => c.id === "logion")!;
    const delta = deterministicDelta(initialSpec, "how does logion work", [capsule], {
      logion: insight,
    });
    return applyOps(initialSpec, delta.ops).next;
  }

  it("puts the measurable facts on screen", () => {
    const next = build();
    const stats = Object.values(next.elements).filter((n) => n.type === "Stat");
    const labels = stats.map((n) => n.props.label);
    expect(labels).toContain("language");
    expect(labels).toContain("stars");
    expect(labels).toContain("last push");
    expect(stats.find((n) => n.props.label === "mix")?.props.value).toBe(
      "Python 80% · TypeScript 20%",
    );
  });

  it("hides structure and README behind closed disclosures, so nothing overflows", () => {
    const next = build();
    const disclosures = Object.values(next.elements).filter((n) => n.type === "Collapsible");
    expect(disclosures.map((n) => n.props.summary).sort()).toEqual([
      "repository structure",
      "what the README covers",
    ]);
    expect(disclosures.every((n) => n.props.open === false)).toBe(true);
  });

  it("still validates and stays reversible", () => {
    const capsule = portfolioCapsules.find((c) => c.id === "logion")!;
    const delta = deterministicDelta(initialSpec, "how does logion work", [capsule], {
      logion: insight,
    });
    const t = commit(createTimeline(initialSpec), {
      id: "d1",
      query: "q",
      source: "deterministic",
      ...delta,
    });
    expect(parsePortfolioSpec(t.current)).not.toBeNull();
    expect(back(t).current).toEqual(initialSpec);
  });

  it("renders nothing extra when nothing was read", () => {
    const capsule = portfolioCapsules.find((c) => c.id === "logion")!;
    const without = applyOps(
      initialSpec,
      deterministicDelta(initialSpec, "what is logion", [capsule]).ops,
    ).next;
    expect(Object.values(without.elements).some((n) => n.type === "Collapsible")).toBe(false);
    expect(Object.values(without.elements).some((n) => n.type === "Stat")).toBe(false);
  });
});

describe("subtreeRemovalOps", () => {
  it("removes children before their parents", () => {
    const { next } = build("what have you built");
    const ops = clearViewOps(next);
    expect(ops.length).toBeGreaterThan(0);
    // Applying in order must not throw, which only holds if the order is
    // children-first: unregistering a parent first would orphan the rest.
    expect(() => applyOps(next, ops)).not.toThrow();
    expect(applyOps(next, ops).next.elements[ROOT_ID].children).toEqual([]);
  });

  it("ignores ids that are not there", () => {
    expect(subtreeRemovalOps(initialSpec, ["ghost"])).toEqual([]);
  });
});

describe("the gate every author passes through", () => {
  const invented = {
    label: "invented component",
    ops: [
      {
        kind: "register",
        id: "x",
        node: { type: "WhateverTheModelInvented", props: {}, children: [] },
      },
      { kind: "attach", parent: "canvas", child: "x" },
    ],
  };

  it("is what catches an invented component type — parseDelta alone does not", () => {
    // The kernel types a node as `type: z.string().min(1)` on purpose: it knows
    // nothing about components. So the schema accepts this, and only the catalog
    // gate can refuse it. A local model going through parseDelta alone would
    // have rendered nothing and taken the page with it.
    expect(parseDelta(invented)).not.toBeNull();
    expect(validateDeltaAgainstSpec(initialSpec, invented)).toBeNull();
  });

  it("refuses a Δ that attaches a node it never registered", () => {
    // The reported crash, verbatim.
    expect(
      validateDeltaAgainstSpec(initialSpec, {
        label: "orphan attach",
        ops: [{ kind: "attach", parent: "canvas", child: "d1-palmares-summary" }],
      }),
    ).toBeNull();
  });

  it("refuses props that do not match the component", () => {
    expect(
      validateDeltaAgainstSpec(initialSpec, {
        label: "bad props",
        ops: [
          { kind: "register", id: "p", node: { type: "Panel", props: { title: 42 }, children: [] } },
          { kind: "attach", parent: "canvas", child: "p" },
        ],
      }),
    ).toBeNull();
  });

  it("refuses anything the schema already rejects", () => {
    for (const input of [null, {}, { label: "x", ops: [] }, { label: "x", ops: [{ kind: "teleport" }] }]) {
      expect(validateDeltaAgainstSpec(initialSpec, input)).toBeNull();
    }
  });

  it("drops an impossible op and keeps the rest", () => {
    // Reported: `unregister` of the root. The kernel is right to refuse it, and
    // losing nineteen good ops with it is the wrong response.
    const mixed = {
      label: "replace the view",
      ops: [
        { kind: "unregister", id: "canvas" },
        { kind: "register", id: "p", node: { type: "Panel", props: { title: "T", note: null }, children: [] } },
        { kind: "attach", parent: "canvas", child: "p" },
      ],
    };

    const delta = validateDeltaAgainstSpec(initialSpec, mixed);
    expect(delta?.ops).toHaveLength(2);
    expect(delta?.ops.some((op) => op.kind === "unregister")).toBe(false);
    // And what comes back is applicable, which is the point.
    expect(applyOps(initialSpec, delta!.ops).next.elements.p).toBeDefined();
  });

  it("still refuses when nothing survives", () => {
    expect(
      validateDeltaAgainstSpec(initialSpec, {
        label: "all impossible",
        ops: [
          { kind: "unregister", id: "canvas" },
          { kind: "attach", parent: "ghost", child: "canvas" },
        ],
      }),
    ).toBeNull();
  });

  it("still refuses when the surviving ops leave an unrenderable document", () => {
    // Tolerance is only safe because the finished document is checked.
    expect(
      validateDeltaAgainstSpec(initialSpec, {
        label: "survives but invalid",
        ops: [
          { kind: "unregister", id: "canvas" },
          { kind: "register", id: "x", node: { type: "NotAComponent", props: {}, children: [] } },
          { kind: "attach", parent: "canvas", child: "x" },
        ],
      }),
    ).toBeNull();
  });

  it("accepts a well-formed Δ and hands it back", () => {
    const good = {
      label: "one panel",
      ops: [
        { kind: "register", id: "p", node: { type: "Panel", props: { title: "T", note: null }, children: [] } },
        { kind: "attach", parent: "canvas", child: "p" },
      ],
    };
    expect(validateDeltaAgainstSpec(initialSpec, good)?.label).toBe("one panel");
  });

  it("passes the deterministic author's own output", () => {
    // Written here and still not trusted.
    const query = "what have you built";
    const proposal = deterministicDelta(initialSpec, query, retrievePortfolio(query));
    expect(validateDeltaAgainstSpec(initialSpec, proposal)).not.toBeNull();
  });
});

describe("checkedDeterministicDelta", () => {
  it("returns a renderable Δ for every preset", () => {
    for (const preset of [
      "What have you built?",
      "Where do you work?",
      "Walk me through your experience",
      "What do you work with?",
      "How can I reach you?",
      "How does logion work?",
    ]) {
      const delta = checkedDeterministicDelta(initialSpec, preset, retrievePortfolio(preset));
      expect(validateDeltaAgainstSpec(initialSpec, delta), preset).not.toBeNull();
      expect(delta.label, preset).not.toBe("refused");
    }
  });
});

describe("refusalDelta", () => {
  it("is itself renderable, so the last resort cannot fail", () => {
    const delta = refusalDelta(initialSpec, "because");
    expect(validateDeltaAgainstSpec(initialSpec, delta)).not.toBeNull();
  });

  it("clears whatever was on screen and says why", () => {
    const query = "what have you built";
    const built = applyOps(
      initialSpec,
      deterministicDelta(initialSpec, query, retrievePortfolio(query)).ops,
    ).next;

    const next = applyOps(built, refusalDelta(built, "the reason").ops).next;
    expect(next.elements[ROOT_ID].children).toEqual(["refusal"]);
    expect(next.elements.refusal.props.body).toBe("the reason");
  });
});

describe("parseDelta", () => {
  it("accepts a well-formed transaction", () => {
    expect(
      parseDelta({
        label: "add a panel",
        ops: [{ kind: "register", id: "p", node: { type: "Text", props: {}, children: [] } }],
      }),
    ).not.toBeNull();
  });

  it("rejects anything malformed", () => {
    const bad: unknown[] = [
      null,
      {},
      { label: "x", ops: [] },
      { ops: [{ kind: "register", id: "p", node: { type: "Text" } }] },
      { label: "x", ops: [{ kind: "teleport", id: "p" }] },
      { label: "x", ops: [{ kind: "register", id: "", node: { type: "Text" } }] },
      { label: "x".repeat(49), ops: [{ kind: "unregister", id: "p" }] },
    ];
    for (const input of bad) expect(parseDelta(input)).toBeNull();
  });
});
