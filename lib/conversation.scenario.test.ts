import type { Spec } from "@json-render/core";
import { describe, expect, it } from "vitest";
import { resolveTurn, type Intent } from "@/lib/conversation";
import { back, commitChecked, createTimeline, replay, type Timeline } from "@/lib/runtime/timeline";
import { reposToRead, type RepoInsight } from "@/lib/sources/github";
import { checkedDeterministicDelta } from "@/lib/ui/delta";
import { initialSpec, parsePortfolioSpec, ROOT_ID } from "@/lib/ui/spec";

/**
 * Conversations, end to end through the pipeline that answers them.
 *
 * Not the model: retrieval, the conversation resolver, the fallback author and
 * the kernel, which is every part that is deterministic and therefore every part
 * that can be pinned by a test. A model can only be as good as the payload it
 * gets, and the failures these conversations used to have were all payload —
 * "put them side by side" arrived at the author having already lost the four
 * projects it was about.
 *
 * The invariants below are checked on *every* turn of *every* conversation,
 * because they are what "multi-turn works" means structurally: the document
 * stays renderable, nothing is left behind, and every turn is still one `back`
 * away from the one before it.
 */

const REPO: RepoInsight = {
  slug: "nicolasmelo1/logion",
  description: "a marketplace for skills",
  primaryLanguage: "TypeScript",
  languages: [{ name: "TypeScript", share: 98 }],
  topics: [],
  stars: 3,
  license: "MIT",
  createdAt: "2025-01-02",
  lastPush: "2026-08-19",
  structure: ["src/", "README.md"],
  readmeSections: ["Install", "Usage"],
};

type Turn = {
  query: string;
  intent: Intent;
  /** Whether the nodes from the previous turn are still on screen afterwards. */
  survives: "all" | "none";
  /** Every capsule kind the answer is built from, exactly. */
  kinds?: Array<"project" | "experience">;
  /** The repository slugs this turn justifies reading. */
  reads?: string[];
};

function nodeIds(spec: Spec) {
  return Object.keys(spec.elements).filter((id) => id !== ROOT_ID);
}

/** Ids that are registered but cannot be reached from the root. */
function orphans(spec: Spec) {
  const reachable = new Set<string>();
  const walk = (id: string) => {
    if (reachable.has(id) || !spec.elements[id]) return;
    reachable.add(id);
    for (const child of spec.elements[id].children ?? []) walk(child);
  };
  walk(spec.root);
  return Object.keys(spec.elements).filter((id) => !reachable.has(id));
}

function statLabels(spec: Spec) {
  return Object.values(spec.elements)
    .filter((element) => element.type === "Stat")
    .map((element) => (element.props as { label?: string }).label);
}

/**
 * Run a conversation, asserting the invariants on every turn and the
 * expectations on the turn that declared them.
 */
function play(turns: Turn[], insights: Record<string, RepoInsight> = {}) {
  let timeline: Timeline = createTimeline(initialSpec);
  const history: string[] = [];

  turns.forEach((turn, index) => {
    const where = `turn ${index + 1} (${turn.query})`;
    const before = nodeIds(timeline.current);
    const previous = timeline.current;

    const { intent, capsules } = resolveTurn(turn.query, history);
    expect(intent, `${where}: intent`).toBe(turn.intent);

    if (turn.kinds) {
      expect([...new Set(capsules.map((c) => c.kind))].sort(), `${where}: subject`).toEqual(
        [...turn.kinds].sort(),
      );
    }
    if (turn.reads) {
      expect(
        reposToRead(turn.query, capsules).map((pick) => pick.slug),
        `${where}: repository reads`,
      ).toEqual(turn.reads);
    }

    const delta = checkedDeterministicDelta(
      timeline.current,
      turn.query,
      capsules,
      insights,
      intent,
    );
    const next = commitChecked(timeline, {
      id: `d${index}`,
      query: turn.query,
      source: "deterministic",
      ...delta,
    });

    // The kernel took it. A refused Δ is a turn that did nothing, which no
    // amount of good retrieval would rescue.
    expect(next, `${where}: the kernel accepted the transaction`).not.toBeNull();
    timeline = next!;
    history.push(turn.query);

    const after = nodeIds(timeline.current);

    // ---- invariants, every turn ----
    expect(parsePortfolioSpec(timeline.current), `${where}: passes the catalog gate`).not.toBeNull();
    expect(orphans(timeline.current), `${where}: no node left registered but unattached`).toEqual([]);
    expect(timeline.current.elements[ROOT_ID]?.type, `${where}: the root survives`).toBe("Canvas");
    expect(timeline.current.root, `${where}: the root is never replaced`).toBe(ROOT_ID);
    expect(after.length, `${where}: the answer is not empty`).toBeGreaterThan(0);
    // Every turn is still one step back from the one before it. This is what
    // makes a wrong answer cheap, and it has to hold after N turns, not one.
    expect(back(timeline).current, `${where}: is reversible`).toEqual(previous);
    expect(replay(timeline), `${where}: replays to the same document`).toEqual(timeline.current);

    // ---- what this turn did to the previous one ----
    const kept = before.filter((id) => after.includes(id));
    if (turn.survives === "all") {
      expect(kept, `${where}: keeps what it was asked to rearrange`).toEqual(before);
    } else {
      expect(kept, `${where}: leaves no residue from the previous subject`).toEqual([]);
    }
  });

  return timeline;
}

describe("a visitor who keeps asking", () => {
  // The conversation from the bug report, in order.
  it("arranges the projects it is looking at instead of destroying them", () => {
    const timeline = play([
      { query: "show me your projects", intent: "replace", survives: "none", kinds: ["project"] },
      { query: "put them side by side", intent: "refine", survives: "all", kinds: ["project"] },
    ]);
    // The refinement is a layout change on the root and nothing else.
    expect(timeline.current.elements[ROOT_ID].props).toMatchObject({ layout: "columns" });
  });

  it("compares the projects against the employers, keeping both", () => {
    play([
      { query: "show me your projects", intent: "replace", survives: "none", kinds: ["project"] },
      { query: "put them side by side", intent: "refine", survives: "all", kinds: ["project"] },
      {
        query: "compare those with where you worked",
        intent: "extend",
        survives: "none",
        kinds: ["project", "experience"],
      },
    ]);
  });

  it("reads the repository for a follow-up that names no project", () => {
    const timeline = play(
      [
        {
          query: "show me your projects",
          intent: "replace",
          survives: "none",
          kinds: ["project"],
          // A bare "what have you built" is not worth four API calls per repo.
          reads: [],
        },
        {
          query: "show me the commit dates",
          intent: "refine",
          survives: "none",
          kinds: ["project"],
          // The subject came from the previous turn, so there is something to
          // read. This returned nothing at all before.
          reads: ["nicolasmelo1/logion", "nicolasmelo1/software-factory"],
        },
      ],
      { logion: REPO },
    );
    // And the fact that was asked for is actually on screen.
    expect(statLabels(timeline.current)).toContain("last push");
  });

  it("changes subject when told to, and takes the old one off the screen", () => {
    play([
      { query: "show me your projects", intent: "replace", survives: "none", kinds: ["project"] },
      {
        query: "where have you worked?",
        intent: "replace",
        survives: "none",
        kinds: ["experience"],
      },
    ]);
  });

  // Six turns of mixed intent, which is where residue and drift would show up.
  it("survives a long conversation without accumulating or drifting", () => {
    const timeline = play([
      { query: "show me your projects", intent: "replace", survives: "none", kinds: ["project"] },
      { query: "put them side by side", intent: "refine", survives: "all", kinds: ["project"] },
      { query: "show me the commit dates", intent: "refine", survives: "none", kinds: ["project"] },
      {
        query: "where have you worked?",
        intent: "replace",
        survives: "none",
        kinds: ["experience"],
      },
      { query: "group them by tag", intent: "refine", survives: "none", kinds: ["experience"] },
      {
        query: "how does logion work",
        intent: "replace",
        survives: "none",
        kinds: ["project"],
        reads: ["nicolasmelo1/logion"],
      },
    ]);
    expect(timeline.entries).toHaveLength(6);
    expect(timeline.cursor).toBe(6);
  });

  it("walks all the way back to the empty canvas it started from", () => {
    let timeline = play([
      { query: "show me your projects", intent: "replace", survives: "none", kinds: ["project"] },
      { query: "put them side by side", intent: "refine", survives: "all", kinds: ["project"] },
      {
        query: "where have you worked?",
        intent: "replace",
        survives: "none",
        kinds: ["experience"],
      },
    ]);
    while (timeline.cursor > 0) timeline = back(timeline);
    expect(timeline.current).toEqual(initialSpec);
  });
});

describe("a refinement with nothing to refine", () => {
  // Someone's first question can be a refinement — from a shared link, or just
  // by starting mid-thought. There is no referent, so it is a new question.
  it("is answered as a new question rather than refusing", () => {
    const { intent } = resolveTurn("put them side by side", []);
    expect(intent).toBe("replace");
    play([{ query: "put them side by side", intent: "replace", survives: "none" }]);
  });
});
