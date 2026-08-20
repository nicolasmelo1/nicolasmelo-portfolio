// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/context/route";
import { clearRepoCache } from "@/lib/sources/github";

function post(body: unknown) {
  return POST(
    new Request("http://local/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  clearRepoCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/context", () => {
  it("rejects a request with no query", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ query: "   " })).status).toBe(400);
  });

  it("answers with the retrieved capsules", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
    const payload = await (await post({ query: "Where do you work?" })).json();
    expect(payload.capsules.map((c: { id: string }) => c.id)).toEqual(["exp-revv"]);
  });

  it("reads the repository when the question justifies it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(url: string) => Promise<Response>>(async (url) =>
        String(url).endsWith("/repos/nicolasmelo1/logion")
          ? new Response(JSON.stringify({ description: "reg", language: "Python" }), { status: 200 })
          : new Response("no", { status: 404 }),
      ),
    );

    const payload = await (await post({ query: "How does logion work?" })).json();
    expect(payload.repos.logion.primaryLanguage).toBe("Python");
  });

  it("does not touch GitHub for a broad question", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const payload = await (await post({ query: "What have you built?" })).json();
    expect(payload.capsules.length).toBeGreaterThan(0);
    expect(payload.repos).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still answers with capsules when GitHub refuses", async () => {
    // This is the whole reason the endpoint exists rather than the browser doing
    // it: a spent quota degrades the answer here, once, instead of printing four
    // 403s into every visitor's console.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 403 })));

    const response = await post({ query: "How does logion work?" });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.capsules.map((c: { id: string }) => c.id)).toEqual(["logion"]);
    expect(payload.repos).toEqual({});
  });
});
