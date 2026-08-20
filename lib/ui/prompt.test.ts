import { describe, expect, it } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { OUTPUT_RESERVE, REQUESTED_CONTEXT } from "@/lib/llm/models";
import { retrievePortfolio } from "@/lib/retrieve";
import { applyOps } from "@/lib/runtime/ops";
import { describeVocabulary } from "@/lib/ui/catalog";
import { deterministicDelta } from "@/lib/ui/delta";
import { buildDeltaPrompt } from "@/lib/ui/prompt";
import { initialSpec } from "@/lib/ui/spec";

/**
 * Deliberately pessimistic: three characters per token rather than the usual
 * four. A budget check that assumes the friendly ratio is not a budget check.
 */
function upperBoundTokens(text: string) {
  return Math.ceil(text.length / 3);
}

const insight = {
  slug: "nicolasmelo1/logion",
  description: "An open, versioned registry of AI-agent artifacts",
  primaryLanguage: "Python",
  languages: [
    { name: "Python", share: 91 },
    { name: "Shell", share: 2 },
    { name: "PowerShell", share: 2 },
    { name: "JavaScript", share: 2 },
    { name: "HTML", share: 1 },
  ],
  topics: ["agents", "ai", "ai-agent", "claude-code", "llm", "mcp", "registry", "skills"],
  stars: 35,
  license: "MIT",
  createdAt: "2026-05-13",
  lastPush: "2026-08-20",
  structure: [".githooks/", ".github/", "docs/", "src/", "tests/", "README.md", "pyproject.toml"],
  readmeSections: ["What it is", "Why", "Install", "Usage", "Publishing", "Protocols"],
};

/**
 * The largest prompt the app can actually produce.
 *
 * Reachable, not hypothetical. Retrieval is capped at four capsules and the
 * repository reader at two, and a Δ replaces the view rather than appending to
 * it, so the spec stays about one answer wide however long the session runs.
 * An earlier version of this handed in all thirteen capsules and reported a
 * budget failure that no request could ever produce.
 */
function worstCasePrompt() {
  const query = "How does logion work?";
  const context = retrievePortfolio(query);
  const grown = applyOps(
    initialSpec,
    deterministicDelta(initialSpec, query, context, { logion: insight }).ops,
  ).next;

  const broad = retrievePortfolio("What have you built?");
  const prompt = buildDeltaPrompt(
    "now group everything by tag and make it compact",
    grown,
    broad,
    {
      [broad[0].id]: insight,
      [broad[1].id]: { ...insight, slug: "nicolasmelo1/software-factory" },
    },
  );
  return prompt.system + prompt.user;
}

describe("the prompt budget", () => {
  it("fits the requested context window with room for the reply", () => {
    // This is the check that was missing. The prompt did not fit 4096, so every
    // local model reported ready and then failed on every request — and nothing
    // in the type system, the tests or the build could see it.
    const tokens = upperBoundTokens(worstCasePrompt());
    expect(tokens + OUTPUT_RESERVE).toBeLessThanOrEqual(REQUESTED_CONTEXT);
  });

  it("is bounded by the caps the code actually enforces", () => {
    // The budget above is only meaningful because these hold.
    expect(retrievePortfolio("What have you built?").length).toBeLessThanOrEqual(4);
    expect(retrievePortfolio("how does everything work here").length).toBeLessThanOrEqual(4);
    expect(portfolioCapsules.length).toBeGreaterThan(4);
  });

  it("still fits with a generous margin, not just barely", () => {
    // Leave headroom for content growth: capsules and repositories both grow
    // without anyone touching this file.
    const tokens = upperBoundTokens(worstCasePrompt());
    expect(tokens).toBeLessThan((REQUESTED_CONTEXT - OUTPUT_RESERVE) * 0.8);
  });
});

describe("describeVocabulary", () => {
  it("names every component and its props", () => {
    const vocabulary = describeVocabulary();
    for (const name of ["Canvas", "Panel", "Accordion", "AccordionItem", "Tabs", "Collapsible", "Stat"]) {
      expect(vocabulary, name).toContain(`${name}(`);
    }
    expect(vocabulary).toContain("layout: stack|columns|grid");
    expect(vocabulary).toContain("items: string[]");
    expect(vocabulary).toContain("open: boolean");
  });

  it("marks which components take children", () => {
    expect(describeVocabulary()).toMatch(/Panel\([^)]*\) \+children/);
    // Badge is a leaf; claiming otherwise would invite an unattachable child.
    expect(describeVocabulary()).toMatch(/Badge\([^)]*\) —/);
  });

  it("is not json-render's protocol manual", () => {
    // The original bug: `portfolioCatalog.prompt()` tells the model to emit
    // JSONL RFC 6902 JSON Patch, contradicting the transaction format this app
    // asks for, in 17,660 characters.
    const vocabulary = describeVocabulary();
    expect(vocabulary).not.toContain("RFC 6902");
    expect(vocabulary).not.toContain("JSON Patch");
    expect(vocabulary).not.toContain('"op":"add"');
    expect(vocabulary.length).toBeLessThan(4000);
  });
});

describe("buildDeltaPrompt", () => {
  it("carries the query, the current view and the context", () => {
    const prompt = buildDeltaPrompt("q", initialSpec, portfolioCapsules.slice(0, 1), {});
    const payload = JSON.parse(prompt.user);
    expect(payload.query).toBe("q");
    expect(payload.current_view.root).toBe("canvas");
    expect(payload.portfolio_context).toHaveLength(1);
    expect(payload.repos).toEqual({});
  });

  it("asks for exactly one transaction, in the app's own format", () => {
    const prompt = buildDeltaPrompt("q", initialSpec, [], {});
    expect(prompt.system).toContain('{"label"');
    expect(prompt.system).toContain('"kind":"register"');
    expect(prompt.system).toContain("THE PAGE NEVER SCROLLS");
  });
});
