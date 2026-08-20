import { bench, describe } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";
import { applyOps } from "@/lib/runtime/ops";
import { back, commit, createTimeline } from "@/lib/runtime/timeline";
import { deterministicDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

// L6.PERFORMANCE_REGRESSION_IS_GUARDED. Retrieval and Δ application run on
// every question; journal travel runs on every back/forward. All three scale
// with the size of content/portfolio.ts and the depth of the session, so they
// are the paths worth watching.
describe("retrieval", () => {
  bench("alias hit", () => {
    retrievePortfolio("masa");
  });

  bench("no hit (scores every capsule, then falls back)", () => {
    retrievePortfolio("zzzzqqq nonexistent gibberish");
  });

  bench("multi-token query", () => {
    retrievePortfolio("agents architecture developer tooling github projects");
  });
});

describe("delta", () => {
  const capsules = portfolioCapsules.slice(0, 4);

  bench("author a Δ", () => {
    deterministicDelta(initialSpec, "what have you built", capsules);
  });

  bench("author and apply a Δ", () => {
    const delta = deterministicDelta(initialSpec, "what have you built", capsules);
    applyOps(initialSpec, delta.ops);
  });
});

describe("journal", () => {
  const delta = deterministicDelta(initialSpec, "what have you built", portfolioCapsules.slice(0, 4));

  bench("commit then walk back", () => {
    const t = commit(createTimeline(initialSpec), {
      id: "d1",
      label: delta.label,
      query: "q",
      source: "deterministic",
      ops: delta.ops,
    });
    back(t);
  });

  bench("ten Δ deep, then unwind to S₀", () => {
    let t = createTimeline(initialSpec);
    for (let i = 0; i < 10; i += 1) {
      const step = deterministicDelta(t.current, `q${i}`, portfolioCapsules.slice(0, 2));
      t = commit(t, { id: `d${i}`, label: step.label, query: `q${i}`, source: "deterministic", ops: step.ops });
    }
    while (t.cursor > 0) t = back(t);
  });
});
