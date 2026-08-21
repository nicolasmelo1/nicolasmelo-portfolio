import { describe, expect, it } from "vitest";
import { anchor, classify, HISTORY_LIMIT, resolveTurn, sanitizeHistory } from "@/lib/conversation";
import { RETRIEVAL_LIMIT } from "@/lib/retrieve";

const ids = (capsules: Array<{ id: string }>) => capsules.map((capsule) => capsule.id);

describe("classify", () => {
  it("reads a question that names its own subject as a new one", () => {
    expect(classify("show me your projects")).toBe("replace");
    expect(classify("where have you worked?")).toBe("replace");
    // `how` is a depth word and this still names Logion, so it is not a
    // refinement of whatever happens to be on screen.
    expect(classify("how does logion work")).toBe("replace");
  });

  it("reads a pronoun or a presentation verb as a refinement", () => {
    expect(classify("put them side by side")).toBe("refine");
    expect(classify("make it compact")).toBe("refine");
    expect(classify("group those by tag")).toBe("refine");
    // Names no subject and asks for a fact about one: only the thing already on
    // screen can be meant.
    expect(classify("show me the commit dates")).toBe("refine");
  });

  it("reads a comparison as needing both subjects", () => {
    expect(classify("compare those with where you worked")).toBe("extend");
    expect(classify("logion vs software factory")).toBe("extend");
  });
});

describe("anchor", () => {
  it("is the last question that chose a subject, not the last question", () => {
    // The referent of "the commit dates" is the projects, three turns back —
    // the two refinements in between never chose a subject.
    expect(
      anchor(["show me your projects", "put them side by side", "make it compact"]),
    ).toBe("show me your projects");
  });

  it("is the newest subject once a new one is chosen", () => {
    expect(anchor(["show me your projects", "where have you worked?"])).toBe(
      "where have you worked?",
    );
  });

  it("falls back to the opening question when every turn was a refinement", () => {
    expect(anchor(["make it compact", "smaller"])).toBe("make it compact");
  });

  it("is null with nothing behind it", () => {
    expect(anchor([])).toBeNull();
  });

  it("cannot reach further back than the history limit", () => {
    const older = ["show me your projects"];
    const filler = Array.from({ length: HISTORY_LIMIT }, () => "make it compact");
    expect(anchor([...older, ...filler])).not.toBe("show me your projects");
  });
});

describe("resolveTurn", () => {
  it("resolves a first question exactly as retrieval alone did", () => {
    const { intent, capsules } = resolveTurn("show me your projects");
    expect(intent).toBe("replace");
    expect(ids(capsules)).toContain("logion");
  });

  // The regression this whole module exists for. `them` used to score against a
  // capsule that reads "save against them at runtime", so the follow-up
  // retrieved an employer and the four projects were cleared to show it.
  it("carries the subject through a pronoun instead of scoring it", () => {
    const first = resolveTurn("show me your projects");
    const second = resolveTurn("put them side by side", ["show me your projects"]);
    expect(second.intent).toBe("refine");
    expect(ids(second.capsules)).toEqual(ids(first.capsules));
    expect(ids(second.capsules)).not.toContain("exp-reflow");
  });

  it("keeps both sides of a comparison, and neither side crowds the other out", () => {
    const { intent, capsules } = resolveTurn("compare those with where you worked", [
      "show me your projects",
    ]);
    expect(intent).toBe("extend");
    const kinds = capsules.map((capsule) => capsule.kind);
    expect(new Set(kinds).size).toBe(2);
    expect(capsules.length).toBeLessThanOrEqual(RETRIEVAL_LIMIT);
    // Half the budget each. A comparison where one side brought five capsules
    // and the other brought one is a list, not a comparison.
    const projects = kinds.filter((kind) => kind === "project").length;
    expect(projects).toBe(kinds.length - projects);
  });

  it("moves the subject when the visitor changes it, and keeps nothing", () => {
    const { intent, capsules } = resolveTurn("where have you worked?", [
      "show me your projects",
    ]);
    expect(intent).toBe("replace");
    expect(capsules.every((capsule) => capsule.kind === "experience")).toBe(true);
  });

  it("resolves a refinement of a refinement against the original subject", () => {
    const resolved = resolveTurn("show me the commit dates", [
      "show me your projects",
      "put them side by side",
    ]);
    expect(resolved.intent).toBe("refine");
    expect(resolved.capsules.every((capsule) => capsule.kind === "project")).toBe(true);
    expect(resolved.subjectQuery).toBe("show me your projects");
  });
});

describe("sanitizeHistory", () => {
  it("keeps only the strings a prompt can carry, newest last", () => {
    expect(sanitizeHistory(["  a  ", "", "b", 7, null, "c"])).toEqual(["a", "b", "c"]);
  });

  it("refuses anything that is not a list", () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory("show me your projects")).toEqual([]);
    expect(sanitizeHistory({ 0: "a" })).toEqual([]);
  });

  it("drops an entry long enough to be a payload rather than a question", () => {
    expect(sanitizeHistory(["x".repeat(401)])).toEqual([]);
  });

  it("keeps the most recent turns when there are more than the limit", () => {
    const many = Array.from({ length: HISTORY_LIMIT + 4 }, (_, i) => `q${i}`);
    const kept = sanitizeHistory(many);
    expect(kept).toHaveLength(HISTORY_LIMIT);
    expect(kept.at(-1)).toBe(`q${many.length - 1}`);
  });
});
