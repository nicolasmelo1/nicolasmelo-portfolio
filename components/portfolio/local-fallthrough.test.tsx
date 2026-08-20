import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";
import { deterministicDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

// A browser that has WebGPU and a local model that comes up but cannot author.
const generateDeltaInBrowser = vi.fn();
vi.mock("@/lib/llm/browser", () => ({
  autoLoadSkipReason: () => null,
  localModelStarted: () => false,
  startLocalModel: async () => ({}),
  activeModel: () => "Qwen3-0.6B-q4f16_1-MLC",
  generateDeltaInBrowser: (...args: unknown[]) => generateDeltaInBrowser(...args),
}));

const { PortfolioApp } = await import("@/components/portfolio/portfolio-app");

const logion = portfolioCapsules.find((c) => c.id === "logion")!;

beforeEach(() => {
  window.localStorage.clear();
  generateDeltaInBrowser.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function serverAnswer() {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (_url, init) => {
    const sent = JSON.parse(String(init?.body)) as { query: string; spec: typeof initialSpec };
    const delta = deterministicDelta(sent.spec, sent.query, retrievePortfolio(sent.query));
    return new Response(JSON.stringify({ delta: { ...delta, label: "from server" }, source: "cloud" }), {
      status: 200,
    });
  });
}

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Ask"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

describe("when the local model is ready but fails to author", () => {
  it("asks the server instead of giving up", async () => {
    // The regression: the local attempt used to share a try block with the
    // server call, so a thrown engine error skipped the server entirely and
    // produced the offline answer — no cloud author, and no repository read.
    generateDeltaInBrowser.mockRejectedValue(new Error("BindingError from the engine"));
    const fetchMock = serverAnswer();
    vi.stubGlobal("fetch", fetchMock);

    render(<PortfolioApp />);
    await waitFor(() => expect(screen.getByText("local model ready · Qwen3 0.6B")).toBeDefined());
    await ask("what is logion");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText(/from server/)).toBeDefined());
    expect(screen.getByText(logion.summary)).toBeDefined();
    expect(screen.queryByText(/offline/)).toBeNull();
  });

  it("also asks the server when the model returns an invalid transaction", async () => {
    generateDeltaInBrowser.mockResolvedValue(null);
    const fetchMock = serverAnswer();
    vi.stubGlobal("fetch", fetchMock);

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.getByText(/from server/)).toBeDefined();
  });

  it("uses the local answer when the model does author one", async () => {
    const delta = deterministicDelta(initialSpec, "what is logion", [logion]);
    generateDeltaInBrowser.mockResolvedValue({ ...delta, label: "from local" });
    const fetchMock = serverAnswer();
    vi.stubGlobal("fetch", fetchMock);

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/from local/)).toBeDefined());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
