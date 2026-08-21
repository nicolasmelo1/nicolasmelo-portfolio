import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";
import { deterministicDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

// A browser that could run a local model, so ordering is what is under test
// rather than capability.
const generateDeltaInBrowser = vi.fn();
const startLocalModel = vi.fn(async () => ({}));
let started = false;

vi.mock("@/lib/llm/browser", () => ({
  autoLoadSkipReason: () => null,
  localModelStarted: () => started,
  startLocalModel: (...args: unknown[]) => {
    started = true;
    return startLocalModel(...(args as []));
  },
  activeModel: () => "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  interruptLocalModel: () => {},
  generateDeltaInBrowser: (...args: unknown[]) => generateDeltaInBrowser(...args),
}));

const { PortfolioApp } = await import("@/components/portfolio/portfolio-app");

const logion = portfolioCapsules.find((c) => c.id === "logion")!;

function deltaLabelled(label: string, query = "what is logion") {
  return { ...deterministicDelta(initialSpec, query, retrievePortfolio(query)), label };
}

/** A route that answers with the given source. */
function route(source: string, label: string) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (_url, init) => {
    const sent = JSON.parse(String(init?.body)) as { query: string; spec: typeof initialSpec };
    const delta = deterministicDelta(sent.spec, sent.query, retrievePortfolio(sent.query));
    return new Response(JSON.stringify({ delta: { ...delta, label }, source }), { status: 200 });
  });
}

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Ask"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  window.localStorage.clear();
  generateDeltaInBrowser.mockReset();
  startLocalModel.mockClear();
  started = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("who authors a Δ, in order", () => {
  it("prefers the cloud and never touches the local model", async () => {
    // The inversion: a 1B model on a laptop GPU took long enough that the whole
    // interface sat disabled, which reads as a freeze whatever the cause.
    const fetchMock = route("cloud", "from cloud");
    vi.stubGlobal("fetch", fetchMock);

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/from cloud/)).toBeDefined());
    expect(screen.getByText(/\/ cloud/)).toBeDefined();
    expect(startLocalModel).not.toHaveBeenCalled();
    expect(generateDeltaInBrowser).not.toHaveBeenCalled();
  });

  it("does not load the local model on mount", async () => {
    vi.stubGlobal("fetch", route("cloud", "from cloud"));
    render(<PortfolioApp />);
    // 672 MB and a shader compilation are not spent speculatively.
    await waitFor(() => expect(screen.getByLabelText("Ask")).toBeDefined());
    expect(startLocalModel).not.toHaveBeenCalled();
  });

  it("falls to the local model when the cloud has no model of its own", async () => {
    // `deterministic` from the route means OpenRouter was absent, down or rate
    // limited. A local model beats the fallback author, so it is worth loading.
    vi.stubGlobal("fetch", route("deterministic", "from route fallback"));
    generateDeltaInBrowser.mockResolvedValue(deltaLabelled("from local"));

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/from local/)).toBeDefined());
    expect(startLocalModel).toHaveBeenCalledOnce();
  });

  it("falls to the local model when the cloud cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    generateDeltaInBrowser.mockResolvedValue(deltaLabelled("from local"));

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/from local/)).toBeDefined());
  });

  it("keeps the route's own fallback when the local model cannot author", async () => {
    // The route's deterministic answer carries the repository read; the
    // browser's cannot. So it is preferred over building one here.
    vi.stubGlobal("fetch", route("deterministic", "from route fallback"));
    generateDeltaInBrowser.mockResolvedValue(null);

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/from route fallback/)).toBeDefined());
    expect(screen.getByText(/\/ deterministic/)).toBeDefined();
  });

  it("ends at the offline author only when everything else failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    generateDeltaInBrowser.mockRejectedValue(new Error("engine died"));

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.getByText(/\/ offline/)).toBeDefined();
  });

  it("does not give up when the local model throws", async () => {
    // The regression that started this: the local attempt shared a try block
    // with the server call, so a thrown engine error skipped the server too.
    vi.stubGlobal("fetch", route("deterministic", "from route fallback"));
    generateDeltaInBrowser.mockRejectedValue(new Error("BindingError from the engine"));

    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/from route fallback/)).toBeDefined());
    expect(screen.queryByText(/\/ offline/)).toBeNull();
  });
});
