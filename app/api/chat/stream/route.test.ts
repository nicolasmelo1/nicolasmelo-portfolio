// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/stream/route";
import { clearFlows } from "@/lib/llm/cache";
import { applyOps, type Op } from "@/lib/runtime/ops";
import { initialSpec, parsePortfolioSpec } from "@/lib/ui/spec";

/**
 * The streaming route is the one that matters for cost.
 *
 * The browser tries it first and only falls back to `/api/chat` when it fails,
 * so a cache that lived only in the other route would be paid for and almost
 * never reached. These tests exist because that mistake is invisible: both
 * routes would look cached, the bill would not change, and nothing would fail.
 */

const MODEL_OPS: Op[] = [
  {
    kind: "register",
    id: "streamed-panel",
    node: { type: "Panel", props: { title: "Streamed", note: null }, children: [] },
  },
  { kind: "attach", parent: "canvas", child: "streamed-panel" },
];

const encoder = new TextEncoder();

/** An SSE body that delivers one whole transaction, in one frame. */
function upstream(ops: Op[] = MODEL_OPS) {
  const content = JSON.stringify({ label: "streamed", ops });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** Only the generation calls. A question that names a project also reads it. */
const generations = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.filter((call) => String(call[0]).includes("openrouter")).length;

function post(body: unknown) {
  return POST(
    new Request("http://local/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Every line of an ndjson body, parsed. */
async function lines(response: Response) {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; op?: Op; label?: string });
}

const originalKey = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  clearFlows();
  process.env.OPENROUTER_API_KEY = "test-key";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  vi.unstubAllGlobals();
});

describe("POST /api/chat/stream", () => {
  it("streams the model's transaction, then keeps it", async () => {
    const fetchMock = vi.fn(async () => upstream());
    vi.stubGlobal("fetch", fetchMock);

    const first = await post({ query: "what is logion", spec: initialSpec });
    expect(first.headers.get("x-flow-cache")).toBe("miss");
    const streamed = await lines(first);
    expect(streamed.at(-1)?.type).toBe("done");
    expect(streamed.filter((line) => line.type === "op")).toHaveLength(MODEL_OPS.length);

    const spentSoFar = fetchMock.mock.calls.length;
    const second = await post({ query: "what is logion", spec: initialSpec });
    expect(second.headers.get("x-flow-cache")).toBe("hit");
    expect(generations(fetchMock), "the model was asked once").toBe(1);
    // Not one request of any kind: the hit is checked before the repository
    // read as well, so a kept answer costs nothing at all.
    expect(fetchMock.mock.calls).toHaveLength(spentSoFar);

    // A replay is the same protocol, so the browser cannot tell the difference:
    // a label, every op, then done.
    const replayed = await lines(second);
    expect(replayed.map((line) => line.type)).toEqual(streamed.map((line) => line.type));
    expect(replayed.filter((line) => line.type === "op").map((line) => line.op)).toEqual(MODEL_OPS);
  });

  it("replays into a document that renders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upstream()));
    await post({ query: "what is logion", spec: initialSpec });

    const ops = (await lines(await post({ query: "what is logion", spec: initialSpec })))
      .filter((line) => line.type === "op")
      .map((line) => line.op as Op);
    expect(parsePortfolioSpec(applyOps(initialSpec, ops).next)).not.toBeNull();
  });

  it("does not answer a different flow from a kept one", async () => {
    const fetchMock = vi.fn(async () => upstream());
    vi.stubGlobal("fetch", fetchMock);

    await post({ query: "side by side", spec: initialSpec, history: ["show me your projects"] });
    await post({ query: "side by side", spec: initialSpec, history: ["where have you worked"] });
    expect(generations(fetchMock)).toBe(2);
  });

  it("keeps nothing when the transaction never applied", async () => {
    // Every op inapplicable, so the route throws rather than finishing.
    const fetchMock = vi.fn(async () =>
      upstream([{ kind: "attach", parent: "ghost", child: "phantom" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const failed = await lines(await post({ query: "what is logion", spec: initialSpec }));
    expect(failed.at(-1)?.type).toBe("error");

    // The next request tries again rather than being served the failure.
    await post({ query: "what is logion", spec: initialSpec });
    expect(generations(fetchMock)).toBe(2);
  });

  it("serves a kept answer even with no provider key configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upstream()));
    await post({ query: "what is logion", spec: initialSpec });

    // The key check sits after the cache check on purpose: a kept answer is not
    // a request, so there is nothing to authenticate.
    delete process.env.OPENROUTER_API_KEY;
    const response = await post({ query: "what is logion", spec: initialSpec });
    expect(response.headers.get("x-flow-cache")).toBe("hit");
    expect((await lines(response)).at(-1)?.type).toBe("done");
  });
});
