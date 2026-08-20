import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";
import {
  clearRepoCache,
  fetchRepoInsight,
  readReposFor,
  repoSlug,
  reposToRead,
  summarizeLanguages,
  summarizeReadme,
  summarizeStructure,
  toInsight,
} from "@/lib/sources/github";

beforeEach(() => {
  clearRepoCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repoSlug", () => {
  it("extracts owner/repo from the forms a link actually takes", () => {
    expect(repoSlug("https://github.com/nicolasmelo1/logion")).toBe("nicolasmelo1/logion");
    expect(repoSlug("http://www.github.com/a/b")).toBe("a/b");
    expect(repoSlug("https://github.com/a/b.git")).toBe("a/b");
    expect(repoSlug("https://github.com/a/b/tree/main/src")).toBe("a/b");
    expect(repoSlug("https://github.com/a/b?tab=readme")).toBe("a/b");
  });

  it("returns null for anything that is not a repository", () => {
    for (const href of [
      "https://github.com/palmaresHQ",
      "https://huggingface.co/spaces/x/y",
      "https://example.com/a/b",
      "not a url",
    ]) {
      expect(repoSlug(href), href).toBeNull();
    }
  });
});

describe("summarizeLanguages", () => {
  it("turns bytes into whole percentages, largest first", () => {
    expect(summarizeLanguages({ Python: 7500, TypeScript: 2500 })).toEqual([
      { name: "Python", share: 75 },
      { name: "TypeScript", share: 25 },
    ]);
  });

  it("never reports a present language as 0%", () => {
    const [, tiny] = summarizeLanguages({ Rust: 999999, Shell: 1 });
    expect(tiny.share).toBe(1);
  });

  it("keeps at most five and survives an empty response", () => {
    const many = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`L${i}`, (9 - i) * 100]),
    );
    expect(summarizeLanguages(many)).toHaveLength(5);
    expect(summarizeLanguages({})).toEqual([]);
  });
});

describe("summarizeStructure", () => {
  it("lists directories first, marked as directories", () => {
    const entries = [
      { name: "README.md", type: "file" },
      { name: "src", type: "dir" },
      { name: "package.json", type: "file" },
      { name: "docs", type: "dir" },
    ];
    expect(summarizeStructure(entries)).toEqual([
      "src/",
      "docs/",
      "README.md",
      "package.json",
    ]);
  });

  it("ignores entries with no name or an unknown type, and caps the list", () => {
    expect(summarizeStructure([{ type: "dir" }, { name: "x", type: "submodule" }])).toEqual([]);
    const wide = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, type: "file" }));
    expect(summarizeStructure(wide)).toHaveLength(12);
  });
});

describe("summarizeReadme", () => {
  it("takes headings in document order, without duplicates", () => {
    const md = "# Logion\n\nintro\n\n## Install\n\n### Usage\n\n## Install\n";
    expect(summarizeReadme(md)).toEqual(["Logion", "Install", "Usage"]);
  });

  it("ignores comments inside fenced blocks", () => {
    // A `#` in a shell example is a comment, not a section. Including those
    // produced outlines full of command fragments.
    const md = "# Real\n\n```sh\n# not a heading\nnpm i\n```\n\n## Also real\n";
    expect(summarizeReadme(md)).toEqual(["Real", "Also real"]);
  });

  it("strips markdown emphasis and trailing hashes", () => {
    expect(summarizeReadme("## **Bold** `code` ##")).toEqual(["Bold code"]);
  });

  it("ignores headings deeper than three levels and caps the outline", () => {
    expect(summarizeReadme("#### too deep")).toEqual([]);
    const long = Array.from({ length: 20 }, (_, i) => `## S${i}`).join("\n");
    expect(summarizeReadme(long)).toHaveLength(10);
  });
});

describe("toInsight", () => {
  it("is null without the repository itself", () => {
    expect(toInsight("a/b", null, { Python: 1 }, [], "# x")).toBeNull();
  });

  it("fills in what is missing rather than failing", () => {
    const insight = toInsight("a/b", {}, null, null, null)!;
    expect(insight.slug).toBe("a/b");
    expect(insight.description).toBeNull();
    expect(insight.languages).toEqual([]);
    expect(insight.topics).toEqual([]);
    expect(insight.stars).toBe(0);
    expect(insight.structure).toEqual([]);
    expect(insight.readmeSections).toEqual([]);
  });

  it("shortens timestamps to a day", () => {
    const insight = toInsight(
      "a/b",
      { created_at: "2026-05-13T10:20:30Z", pushed_at: "2026-08-20T01:02:03Z" },
      null,
      null,
      null,
    )!;
    expect(insight.createdAt).toBe("2026-05-13");
    expect(insight.lastPush).toBe("2026-08-20");
  });
});

describe("reposToRead", () => {
  const projects = portfolioCapsules.filter((c) => c.kind === "project");

  it("reads a repository when the question names the project", () => {
    expect(reposToRead("what is logion", projects)).toEqual([
      { capsuleId: "logion", slug: "nicolasmelo1/logion" },
    ]);
  });

  it("reads when the question asks something only the repo can answer", () => {
    for (const query of [
      "how does it work",
      "what is the structure",
      "which language is it in",
      "tell me more",
    ]) {
      expect(reposToRead(query, projects).length, query).toBeGreaterThan(0);
    }
  });

  // Through the real path: the route passes the *retrieved* capsules, not every
  // project. Two earlier versions of this test were wrong — one asked "what do
  // you do" instead of the real preset, and the next handed in every project
  // rather than what retrieval actually returns.
  it("does not read for any of the broad presets", () => {
    for (const preset of [
      "What have you built?",
      "Where do you work?",
      "Walk me through your experience",
      "What do you work with?",
      "How can I reach you?",
    ]) {
      expect(reposToRead(preset, retrievePortfolio(preset)), preset).toEqual([]);
    }
  });

  it("does read for the follow-up questions the presets lead to", () => {
    for (const query of [
      "how does logion work",
      "what is the structure of software factory",
      "tell me more about palindromon",
    ]) {
      expect(reposToRead(query, retrievePortfolio(query)).length, query).toBeGreaterThan(0);
    }
  });

  it("never reads non-project capsules", () => {
    const notProjects = portfolioCapsules.filter((c) => c.kind !== "project");
    expect(reposToRead("how does it work", notProjects)).toEqual([]);
  });

  it("skips a project whose link is not a repository", () => {
    // Palmares links to the organisation, not to a repo.
    const palmares = portfolioCapsules.filter((c) => c.id === "palmares");
    expect(reposToRead("palmares structure", palmares)).toEqual([]);
  });

  it("reads at most two, however many match", () => {
    expect(reposToRead("how does all of this work", projects).length).toBeLessThanOrEqual(2);
  });
});

describe("fetchRepoInsight", () => {
  function githubReturning(status: number, bodies: Record<string, unknown> = {}) {
    return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      const key = Object.keys(bodies).find((k) => String(url).includes(k));
      if (status !== 200 || !key) return new Response("no", { status });
      const body = bodies[key];
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
    });
  }

  it("assembles an insight from the four calls", async () => {
    vi.stubGlobal(
      "fetch",
      githubReturning(200, {
        "/languages": { Python: 100 },
        "/contents": [{ name: "src", type: "dir" }],
        "/readme": "# Title\n## Second\n",
        "/repos/nicolasmelo1/logion": { description: "d", language: "Python", stargazers_count: 35 },
      }),
    );

    const insight = await fetchRepoInsight("nicolasmelo1/logion");
    expect(insight?.description).toBe("d");
    expect(insight?.stars).toBe(35);
    expect(insight?.languages).toEqual([{ name: "Python", share: 100 }]);
    expect(insight?.structure).toEqual(["src/"]);
    expect(insight?.readmeSections).toEqual(["Title", "Second"]);
  });

  it("returns null when GitHub refuses, and does not throw", async () => {
    vi.stubGlobal("fetch", githubReturning(403));
    await expect(fetchRepoInsight("a/b")).resolves.toBeNull();
  });

  it("returns null when the network throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(fetchRepoInsight("a/b")).resolves.toBeNull();
  });

  it("still yields an insight when only the repository call succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      githubReturning(200, { "/repos/a/b": { description: "only this" } }),
    );
    const insight = await fetchRepoInsight("a/b");
    expect(insight?.description).toBe("only this");
    expect(insight?.readmeSections).toEqual([]);
  });

  it("caches, including the miss, so a rate-limited window is not hammered", async () => {
    const fetchMock = githubReturning(403);
    vi.stubGlobal("fetch", fetchMock);

    await fetchRepoInsight("a/b");
    const afterFirst = fetchMock.mock.calls.length;
    await fetchRepoInsight("a/b");

    expect(fetchMock.mock.calls.length).toBe(afterFirst);
    expect(afterFirst).toBe(4);
  });
});

describe("authentication and quota", () => {
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    vi.useRealTimers();
  });

  function capture() {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response("no", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends no Authorization header when no token is configured", async () => {
    delete process.env.GITHUB_TOKEN;
    const fetchMock = capture();
    await fetchRepoInsight("a/b");
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    }
  });

  it("authenticates when a token is configured, on every call", async () => {
    // Unauthenticated is 60 requests an hour per address, and on a deployed
    // site every visitor shares the server's address.
    process.env.GITHUB_TOKEN = "ghp_test";
    const fetchMock = capture();
    await fetchRepoInsight("a/b");
    expect(fetchMock.mock.calls.length).toBe(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ghp_test");
    }
  });

  it("retries a rate-limited repository sooner than a missing one", async () => {
    // A 403 means the budget is spent, which recovers; a 404 does not. Caching
    // both for six hours would keep a transient refusal for the whole window.
    vi.useFakeTimers();
    const refuse = (status: number) =>
      vi.fn<(url: string) => Promise<Response>>(async () => new Response("no", { status }));

    const limited = refuse(403);
    vi.stubGlobal("fetch", limited);
    await fetchRepoInsight("rate/limited");
    expect(limited.mock.calls.length).toBe(4);

    const missing = refuse(404);
    vi.stubGlobal("fetch", missing);
    await fetchRepoInsight("not/found");
    expect(missing.mock.calls.length).toBe(4);

    // Twenty minutes on: the rate-limited one is worth trying again.
    vi.advanceTimersByTime(20 * 60 * 1000);

    const retry = refuse(404);
    vi.stubGlobal("fetch", retry);
    await fetchRepoInsight("rate/limited");
    expect(retry.mock.calls.length, "rate-limited entry should have expired").toBe(4);

    await fetchRepoInsight("not/found");
    expect(retry.mock.calls.length, "missing entry should still be cached").toBe(4);
  });
});

describe("readReposFor", () => {
  it("returns an empty map without touching the network when nothing qualifies", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readReposFor("what do you do", portfolioCapsules)).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys the results by capsule, dropping the ones that failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(url: string) => Promise<Response>>(async (url) =>
        String(url).endsWith("/repos/nicolasmelo1/logion")
          ? new Response(JSON.stringify({ description: "reg" }), { status: 200 })
          : new Response("no", { status: 404 }),
      ),
    );

    const insights = await readReposFor("what is logion", portfolioCapsules);
    expect(Object.keys(insights)).toEqual(["logion"]);
    expect(insights.logion.description).toBe("reg");
  });
});
