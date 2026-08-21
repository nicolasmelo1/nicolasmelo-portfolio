// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { clearFlows } from "@/lib/llm/cache";
import { applyOps } from "@/lib/runtime/ops";
import { initialSpec, parsePortfolioSpec } from "@/lib/ui/spec";

function post(body: unknown) {
  return POST(
    new Request("http://local/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const originalKey = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  // The cache outlives a request by design, which means it outlives a test.
  // Two cases here post the same question against the same document, and
  // without this the second one is served the first one's answer.
  clearFlows();
  delete process.env.OPENROUTER_API_KEY;
  // Stated rather than assumed. These cases are about the no-key path, and a
  // real key reaching this process would make them fail for a reason that has
  // nothing to do with the code under test — which happened once, and cost more
  // time to explain than this line costs to keep.
  expect(process.env.OPENROUTER_API_KEY, "a real key leaked into the test env").toBeUndefined();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  vi.unstubAllGlobals();
});

describe("POST /api/chat", () => {
  it("rejects a request with no query", async () => {
    const response = await post({ spec: initialSpec });
    expect(response.status).toBe(400);
  });

  it("rejects a request with no spec", async () => {
    const response = await post({ query: "what is logion" });
    expect(response.status).toBe(400);
  });

  it("rejects a spec that does not validate", async () => {
    const response = await post({ query: "hi", spec: { root: "nope", elements: {} } });
    expect(response.status).toBe(400);
  });

  it("answers deterministically when no API key is configured", async () => {
    const response = await post({ query: "what is logion", spec: initialSpec });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.source).toBe("deterministic");
    expect(payload.delta.ops.length).toBeGreaterThan(0);
    expect(payload.delta.label).toBeTruthy();
    // The Δ the route hands back must apply to the spec the caller sent.
    const applied = applyOps(initialSpec, payload.delta.ops).next;
    expect(parsePortfolioSpec(applied)).not.toBeNull();
  });

  it("does not call the model provider when no API key is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await post({ query: "what is logion", spec: initialSpec });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a deterministic answer when the provider errors", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    const response = await post({ query: "what is logion", spec: initialSpec });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.source).toBe("deterministic");
  });

  it("falls back when the provider returns a spec that does not validate", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ label: "bad", ops: [{ kind: "teleport" }] }) } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const response = await post({ query: "what is logion", spec: initialSpec });
    expect((await response.json()).source).toBe("deterministic");
  });

  it("sends the key as a bearer token and never returns it", async () => {
    process.env.OPENROUTER_API_KEY = "super-secret-key";
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response("boom", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await post({ query: "what is logion", spec: initialSpec });
    const raw = await response.text();

    expect(raw).not.toContain("super-secret-key");
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer super-secret-key");
  });

  it("accepts a code-fenced transaction from the provider", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const delta = {
      label: "one panel",
      ops: [
        {
          kind: "register",
          id: "p",
          node: { type: "Panel", props: { title: "T", note: null }, children: [] },
        },
        { kind: "attach", parent: "canvas", child: "p" },
      ],
    };
    const fenced = "```json\n" + JSON.stringify(delta) + "\n```";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: fenced } }] }), {
          status: 200,
        }),
      ),
    );

    const payload = await (await post({ query: "hi", spec: initialSpec })).json();
    expect(payload.source).toBe("cloud");
    expect(payload.delta.label).toBe("one panel");
  });

  it("falls back when the provider's transaction is well-formed but does not apply", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    // Schema-valid ops that reference an element that does not exist. Caught by
    // trial-applying on the server rather than thrown in the browser.
    const delta = {
      label: "attach to nothing",
      ops: [{ kind: "attach", parent: "does-not-exist", child: "canvas" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(delta) } }] }), {
          status: 200,
        }),
      ),
    );

    const payload = await (await post({ query: "hi", spec: initialSpec })).json();
    expect(payload.source).toBe("deterministic");
  });

  it("falls back when the provider's transaction would produce an unrenderable document", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const delta = {
      label: "unknown component",
      ops: [
        {
          kind: "register",
          id: "x",
          node: { type: "ScriptTag", props: {}, children: [] },
        },
        { kind: "attach", parent: "canvas", child: "x" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(delta) } }] }), {
          status: 200,
        }),
      ),
    );

    const payload = await (await post({ query: "hi", spec: initialSpec })).json();
    expect(payload.source).toBe("deterministic");
  });
});

/**
 * Generation is the only expensive part of this app, and it is the same work
 * every time the same visitor path arrives. These are the tests that say the
 * second visitor does not pay for it.
 */
describe("the flow cache", () => {
  const delta = {
    label: "one panel",
    ops: [
      {
        kind: "register",
        id: "p",
        node: { type: "Panel", props: { title: "T", note: null }, children: [] },
      },
      { kind: "attach", parent: "canvas", child: "p" },
    ],
  };

  function provider() {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(delta) } }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("asks the provider once for the same question on the same document", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = provider();

    const first = await post({ query: "what is logion", spec: initialSpec });
    expect(first.headers.get("x-flow-cache")).toBe("miss");
    const second = await post({ query: "what is logion", spec: initialSpec });
    expect(second.headers.get("x-flow-cache")).toBe("hit");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // And the answer is the same one, not a smaller one.
    expect((await second.json()).delta).toEqual((await first.json()).delta);
  });

  it("still asks when the same words follow a different question", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = provider();

    await post({ query: "put them side by side", spec: initialSpec, history: ["show me your projects"] });
    await post({ query: "put them side by side", spec: initialSpec, history: ["where have you worked"] });

    // Two flows, two answers. This is the whole reason the key is not the query.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing when the model failed and the fallback answered", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = provider();
    // First request fails upstream, so the deterministic author answers.
    fetchMock.mockImplementationOnce(async () => new Response("boom", { status: 500 }));

    const fell = await post({ query: "what is logion", spec: initialSpec });
    expect((await fell.json()).source).toBe("deterministic");

    // The next visitor gets a real attempt rather than the fallback for hours.
    const retried = await post({ query: "what is logion", spec: initialSpec });
    expect((await retried.json()).source).toBe("cloud");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
