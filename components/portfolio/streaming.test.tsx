import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";
import type { Op } from "@/lib/runtime/ops";
import { deterministicDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

vi.mock("@/lib/llm/browser", () => ({
  autoLoadSkipReason: () => "no-webgpu",
  localModelStarted: () => false,
  startLocalModel: async () => ({}),
  activeModel: () => null,
  interruptLocalModel: () => {},
  generateDeltaInBrowser: async () => null,
}));

const { PortfolioApp } = await import("@/components/portfolio/portfolio-app");

const logion = portfolioCapsules.find((c) => c.id === "logion")!;

/** The ops a model would send for a one-panel answer. */
const MODEL_OPS: Op[] = [
  {
    kind: "register",
    id: "streamed-panel",
    node: { type: "Panel", props: { title: "Streamed answer", note: null }, children: [] },
  },
  {
    kind: "register",
    id: "streamed-text",
    node: { type: "Text", props: { text: "Assembled while the model was writing." }, children: [] },
  },
  { kind: "attach", parent: "streamed-panel", child: "streamed-text" },
  { kind: "attach", parent: "canvas", child: "streamed-panel" },
];

const encoder = new TextEncoder();

/**
 * A streaming response under the test's control: `emit` pushes a line, `end`
 * closes the body.
 */
function controllable() {
  let push: ((line: unknown) => void) | null = null;
  let close: (() => void) | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (line) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      close = () => controller.close();
    },
  });
  return {
    response: new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }),
    emit: (line: unknown) => push?.(line),
    end: () => close?.(),
  };
}

/** Routes `/api/chat/stream` to the given stream, and `/api/chat` to a fallback. */
function routes(stream: Response, fallbackLabel = "plain fallback") {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    if (String(url).endsWith("/stream")) return stream;
    const sent = JSON.parse(String(init?.body)) as { query: string; spec: typeof initialSpec };
    const delta = deterministicDelta(sent.spec, sent.query, retrievePortfolio(sent.query));
    return new Response(
      JSON.stringify({ delta: { ...delta, label: fallbackLabel }, source: "deterministic" }),
      { status: 200 },
    );
  });
}

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Ask"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a streamed transaction assembles as it arrives", () => {
  it("shows the deterministic answer first, then the streamed one", async () => {
    const stream = controllable();
    vi.stubGlobal("fetch", routes(stream.response));

    render(<PortfolioApp />);
    await ask("what is logion");

    // Instantly, with nothing streamed yet.
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    stream.emit({ type: "label", label: "streamed label" });
    for (const op of MODEL_OPS) stream.emit({ type: "op", op });

    // Applied before `done`: this is the point of streaming.
    await waitFor(() =>
      expect(screen.getByText("Assembled while the model was writing.")).toBeDefined(),
    );
    expect(screen.queryByText(logion.summary)).toBeNull();

    stream.emit({ type: "done" });
    stream.end();

    await waitFor(() => expect(screen.getByText(/streamed label/)).toBeDefined());
  });

  it("commits one Δ per question, not one per author", async () => {
    const stream = controllable();
    vi.stubGlobal("fetch", routes(stream.response));

    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    for (const op of MODEL_OPS) stream.emit({ type: "op", op });
    stream.emit({ type: "done" });
    stream.end();
    await waitFor(() => expect(screen.getByText(/\/ cloud/)).toBeDefined());

    expect(screen.queryByText(/discarded/)).toBeNull();
    // One entry: back goes straight to the empty state.
    await userEvent.setup().click(screen.getByRole("button", { name: /Back to the previous/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined(),
    );
  });
});

describe("abandoning a stream returns to the last valid state", () => {
  it("stop mid-stream restores the answer from before the stream", async () => {
    const stream = controllable();
    vi.stubGlobal("fetch", routes(stream.response));

    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    for (const op of MODEL_OPS) stream.emit({ type: "op", op });
    await waitFor(() =>
      expect(screen.getByText("Assembled while the model was writing.")).toBeDefined(),
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Stop the model" }));

    // A partial transaction is not a checkpoint: it is dropped whole.
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.queryByText("Assembled while the model was writing.")).toBeNull();
  });

  it("back mid-stream does the same, rather than navigating away", async () => {
    const stream = controllable();
    vi.stubGlobal("fetch", routes(stream.response));

    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    for (const op of MODEL_OPS) stream.emit({ type: "op", op });
    await waitFor(() =>
      expect(screen.getByText("Assembled while the model was writing.")).toBeDefined(),
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /Back to the previous/ }));

    // The last valid state is the one before the stream started — not the one
    // before the question.
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.queryByRole("heading", { name: "What do you want to know?" })).toBeNull();
  });

  it("a truncated stream leaves the provisional answer and falls back", async () => {
    const stream = controllable();
    vi.stubGlobal("fetch", routes(stream.response, "plain fallback"));

    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    // Two ops and then the connection dies: no `done`, so nothing is committed.
    stream.emit({ type: "op", op: MODEL_OPS[0] });
    stream.emit({ type: "op", op: MODEL_OPS[1] });
    stream.end();

    await waitFor(() => expect(screen.getByText(/plain fallback/)).toBeDefined());
    expect(screen.queryByText("Assembled while the model was writing.")).toBeNull();
  });

  it("an unavailable stream falls through without waiting", async () => {
    const stream = controllable();
    vi.stubGlobal("fetch", routes(stream.response, "plain fallback"));

    render(<PortfolioApp />);
    await ask("what is logion");

    stream.emit({ type: "unavailable", reason: "no api key" });
    stream.end();

    await waitFor(() => expect(screen.getByText(/plain fallback/)).toBeDefined());
  });

  it("a new question drops the stream and answers the new one", async () => {
    const stream = controllable();
    vi.stubGlobal("fetch", routes(stream.response));

    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    for (const op of MODEL_OPS) stream.emit({ type: "op", op });
    await waitFor(() =>
      expect(screen.getByText("Assembled while the model was writing.")).toBeDefined(),
    );

    // The second question gets its own stream, which never emits.
    const second = controllable();
    vi.stubGlobal("fetch", routes(second.response));
    await ask("how can I reach you");

    await waitFor(() =>
      expect(screen.queryByText("Assembled while the model was writing.")).toBeNull(),
    );
    expect(screen.getByText(/how can I reach you/)).toBeDefined();
  });
});
