import { describe, expect, it } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";

describe("retrievePortfolio", () => {
  it("ranks an alias hit first", () => {
    expect(retrievePortfolio("logion")[0].id).toBe("logion");
    expect(retrievePortfolio("software factory")[0].id).toBe("software-factory");
    expect(retrievePortfolio("palmares")[0].id).toBe("palmares");
    expect(retrievePortfolio("palindromon")[0].id).toBe("palindrl");
  });

  // This used to document a bias: a kind-shaped word anywhere in the query beat
  // a named alias, so "tell me about logion" led with the about capsule. One
  // intent kind and no stacked boosts fixed it, so the named thing now wins.
  it("lets a named subject beat the generic word next to it", () => {
    expect(retrievePortfolio("tell me about logion")[0].id).toBe("logion");
    expect(retrievePortfolio("tell me about your work at seedify")[0].id).toBe("exp-seedify");
  });

  it("has nothing to say about MASA, which is not this portfolio's work", () => {
    const ids = retrievePortfolio("masa").map((c) => c.id);
    expect(ids).not.toContain("masa-framework");
    // A miss falls back rather than inventing, so the answer is the intro set.
    expect(ids).toEqual(retrievePortfolio("zzzzqqq nonexistent gibberish").map((c) => c.id));
  });

  it("routes a kind-shaped question to that kind", () => {
    expect(retrievePortfolio("what is your stack")[0].kind).toBe("skills");
    expect(retrievePortfolio("who are you")[0].kind).toBe("about");
    expect(retrievePortfolio("how can I reach you")[0].kind).toBe("contact");
  });

  it("surfaces projects for a projects question", () => {
    const kinds = retrievePortfolio("what have you built").map((c) => c.kind);
    expect(kinds).toContain("project");
  });

  it("introduces him when nothing scores, instead of guessing", () => {
    const result = retrievePortfolio("zzzzqqq nonexistent gibberish");
    expect(result.map((c) => c.kind)).toEqual(["about", "experience", "project"]);
    // The current role, not an arbitrary one.
    expect(result[1].id).toBe("exp-revv");
  });

  it("answers employment questions with employers, not repositories", () => {
    for (const query of [
      "where do you work",
      "what is your experience",
      "tell me about your career",
      "which companies have you worked for",
      "are you senior",
    ]) {
      expect(retrievePortfolio(query)[0].kind, query).toBe("experience");
    }
  });

  it("leads with the current role for a present-tense question", () => {
    expect(retrievePortfolio("where do you work")[0].id).toBe("exp-revv");
    expect(retrievePortfolio("what do you do now")[0].id).toBe("exp-revv");
  });

  it("returns the four most recent roles for an open experience question", () => {
    // Every experience capsule gets the same boost, so ties resolve to file
    // order — which is reverse-chronological, so the default limit yields the
    // four most recent rather than four arbitrary ones.
    const ids = retrievePortfolio("walk me through your experience").map((c) => c.id);
    expect(ids).toEqual(["exp-revv", "exp-seedify", "exp-mindcloud", "exp-launchcode"]);
  });

  it("finds a specific employer by name", () => {
    expect(retrievePortfolio("seedify")[0].id).toBe("exp-seedify");
    expect(retrievePortfolio("what did you do at reflow")[0].id).toBe("exp-reflow");
    expect(retrievePortfolio("mindcloud")[0].id).toBe("exp-mindcloud");
    expect(retrievePortfolio("onesight")[0].id).toBe("exp-onesight");
  });

  it("routes education and certification questions to education", () => {
    for (const query of [
      "where did you study",
      "what is your degree",
      "which university",
      "do you have certifications",
    ]) {
      expect(retrievePortfolio(query)[0].kind, query).toBe("education");
    }
  });

  it("still sends build questions to projects", () => {
    expect(retrievePortfolio("what have you built")[0].kind).toBe("project");
    expect(retrievePortfolio("show me your github repos")[0].kind).toBe("project");
  });

  it("never returns more than the limit, and may return fewer", () => {
    // Fewer is the point: the relevance cutoff drops capsules that only share
    // an incidental word, so a precise question yields a short answer rather
    // than being padded out to the limit.
    expect(retrievePortfolio("agents architecture github tools", 2).length).toBeLessThanOrEqual(2);
    expect(retrievePortfolio("agents architecture github tools").length).toBeLessThanOrEqual(4);
    expect(retrievePortfolio("agents architecture github tools").length).toBeGreaterThan(0);
  });

  it("answers a precise question precisely", () => {
    // "How does logion work?" used to return Logion plus three unrelated jobs,
    // because `work` collected the employment category for every role.
    expect(retrievePortfolio("How does logion work?").map((c) => c.id)).toEqual(["logion"]);
    expect(retrievePortfolio("Where do you work?").map((c) => c.id)).toEqual(["exp-revv"]);
    expect(retrievePortfolio("What do you work with?").map((c) => c.id)).toEqual(["skills"]);
    expect(retrievePortfolio("How can I reach you?").map((c) => c.id)).toEqual(["contact"]);
  });

  it("is case-insensitive", () => {
    expect(retrievePortfolio("LOGION")[0].id).toBe("logion");
    expect(retrievePortfolio("Palmares")[0].id).toBe("palmares");
  });

  it("strips diacritics rather than missing on them", () => {
    // The previous version of this test asserted only `length > 0`, which the
    // no-hit fallback satisfies for any input at all — it would have passed
    // with diacritic handling entirely broken.
    expect(retrievePortfolio("palmarés")[0].id).toBe("palmares");
  });

  it("only ever returns capsules that exist in the content file", () => {
    const ids = new Set(portfolioCapsules.map((c) => c.id));
    for (const capsule of retrievePortfolio("projects and skills")) {
      expect(ids.has(capsule.id)).toBe(true);
    }
  });
});
