import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { retrievePortfolio } from "@/lib/retrieve";
import { deterministicDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

const generateDeltaInBrowser = vi.fn();
const interruptLocalModel = vi.fn();

vi.mock("@/lib/llm/browser", () => ({
  autoLoadSkipReason: () => null,
  localModelStarted: () => true,
  startLocalModel: async () => ({}),
  activeModel: () => "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  interruptLocalModel: () => interruptLocalModel(),
  generateDeltaInBrowser: (...args: unknown[]) => generateDeltaInBrowser(...args),
}));

const { PortfolioApp } = await import("@/components/portfolio/portfolio-app");

const logion = portfolioCapsules.find((c) => c.id === "logion")!;
const contact = portfolioCapsules.find((c) => c.id === "contact")!;

function labelled(label: string, query: string) {
  return { ...deterministicDelta(initialSpec, query, retrievePortfolio(query)), label };
}

/** A route that never answers, so the provisional state can be inspected. */
function hangingRoute() {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
}

function answeringRoute(label: string, source = "cloud") {
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
  generateDeltaInBrowser.mockResolvedValue(null);
  interruptLocalModel.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("answering immediately, improving after", () => {
  it("renders an answer before the network has replied at all", () => {
    // The point of the whole arrangement: a question always produces a page.
    // Waiting for the route before rendering anything was the bug behind "the
    // endpoint returned 200 and the page did not change".
    vi.stubGlobal("fetch", hangingRoute());

    render(<PortfolioApp />);
    void ask("what is logion");

    return waitFor(() => {
      expect(screen.getByText(logion.summary)).toBeDefined();
      expect(screen.getByText(/\/ offline/)).toBeDefined();
    });
  });

  it("never disables the composer", async () => {
    vi.stubGlobal("fetch", hangingRoute());
    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.getByLabelText("Ask")).toHaveProperty("disabled", false);
  });

  it("says a better answer is still coming, and offers to stop waiting", async () => {
    vi.stubGlobal("fetch", hangingRoute());
    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/refining/)).toBeDefined());
    expect(screen.getByRole("button", { name: "Stop the model" })).toBeDefined();
  });

  it("replaces the provisional answer when the model answers", async () => {
    vi.stubGlobal("fetch", answeringRoute("from cloud"));
    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/from cloud/)).toBeDefined());
    expect(screen.getByText(/\/ cloud/)).toBeDefined();
    // One question, one Δ: the provisional was superseded, not stacked on.
    expect(screen.queryByText(/discarded/)).toBeNull();
    expect(screen.getByRole("button", { name: /Back to the previous/ })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("walks back past a refined answer straight to the empty state", async () => {
    vi.stubGlobal("fetch", answeringRoute("from cloud"));
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(/from cloud/)).toBeDefined());

    await userEvent.setup().click(screen.getByRole("button", { name: /Back to the previous/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined(),
    );
  });
});

describe("stop and resume", () => {
  it("stop keeps the answer on screen and offers a retry", async () => {
    vi.stubGlobal("fetch", hangingRoute());
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(/refining/)).toBeDefined());

    await userEvent.setup().click(screen.getByRole("button", { name: "Stop the model" }));

    await waitFor(() => expect(screen.getByText(/stopped/)).toBeDefined());
    expect(screen.getByText(logion.summary)).toBeDefined();
    expect(interruptLocalModel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ask the model again" })).toBeDefined();
  });

  it("resume asks again and applies the answer", async () => {
    vi.stubGlobal("fetch", hangingRoute());
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(/refining/)).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Stop the model" }));
    await waitFor(() => expect(screen.getByText(/stopped/)).toBeDefined());

    vi.stubGlobal("fetch", answeringRoute("resumed answer"));
    await user.click(screen.getByRole("button", { name: "Ask the model again" }));

    await waitFor(() => expect(screen.getByText(/resumed answer/)).toBeDefined());
    expect(screen.queryByText(/discarded/)).toBeNull();
  });

  it("offers a retry when the model settled without authoring", async () => {
    vi.stubGlobal("fetch", answeringRoute("route fallback", "deterministic"));
    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(/model did not answer/)).toBeDefined());
    expect(screen.getByRole("button", { name: "Ask the model again" })).toBeDefined();
  });
});

describe("a new question while waiting", () => {
  it("cancels the inference and answers the new question straight away", async () => {
    const fetchMock = hangingRoute();
    vi.stubGlobal("fetch", fetchMock);

    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    await ask("how can I reach you");

    // The new question is answered immediately, and the old inference is dropped.
    await waitFor(() => expect(screen.getByText(contact.summary)).toBeDefined());
    expect(screen.queryByText(logion.summary)).toBeNull();
    expect(interruptLocalModel).toHaveBeenCalled();
  });

  it("does not let a late answer to an old question overwrite the new page", async () => {
    // The race that matters: the first inference finishes after the visitor has
    // moved on, and its Δ was authored against a document that is gone.
    // A holder rather than a `let`: TypeScript narrows the variable to `never`
    // from its initialiser and then refuses the call.
    const pending: { resolve?: (response: Response) => void } = {};
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async (_url, init) => {
        const sent = JSON.parse(String(init?.body)) as { query: string; spec: typeof initialSpec };
        if (sent.query === "what is logion") {
          return new Promise<Response>((resolve) => {
            pending.resolve = resolve;
          });
        }
        const delta = deterministicDelta(sent.spec, sent.query, retrievePortfolio(sent.query));
        return new Response(
          JSON.stringify({ delta: { ...delta, label: "second answer" }, source: "cloud" }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    await ask("how can I reach you");
    await waitFor(() => expect(screen.getByText(/second answer/)).toBeDefined());

    // Now let the stale request finish.
    pending.resolve?.(
      new Response(JSON.stringify({ delta: labelled("stale answer", "what is logion"), source: "cloud" }), {
        status: 200,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText(/second answer/)).toBeDefined();
    expect(screen.queryByText(/stale answer/)).toBeNull();
  });
});
