import { renderToString } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioApp } from "@/components/portfolio/portfolio-app";
import { portfolioCapsules } from "@/content/portfolio";
import { resolveTurn } from "@/lib/conversation";
import { retrievePortfolio } from "@/lib/retrieve";
import { deterministicDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

const STORAGE_KEY = "nicolasmelo.portfolio.journal.v2";
const logion = portfolioCapsules.find((c) => c.id === "logion")!;
const contact = portfolioCapsules.find((c) => c.id === "contact")!;

/**
 * A stand-in for the route: it authors the Δ against the spec the client
 * actually posted, which is what makes "replace the current view" work. Building
 * it against `initialSpec` instead would silently produce a Δ that appends.
 */
function serverReturning(label: string, query: string, source = "cloud") {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (_url, init) => {
    const sent = JSON.parse(String(init?.body)) as { spec: typeof initialSpec };
    const delta = deterministicDelta(sent.spec, query, retrievePortfolio(query));
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the empty state", () => {
  it("is a centred chat with clickable presets and no document", () => {
    render(<PortfolioApp />);
    expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined();
    expect(screen.getByLabelText("Ask")).toBeDefined();
    expect(screen.getByRole("button", { name: "Where do you work?" })).toBeDefined();
    expect(screen.getByRole("button", { name: "What have you built?" })).toBeDefined();
  });

  it("offers no history to travel through yet", () => {
    render(<PortfolioApp />);
    expect(screen.queryByRole("button", { name: /Back to the previous/ })).toBeNull();
  });

  // The status says *why* there was no second chance, and only once the cloud
  // has already failed — the local model is not loaded speculatively any more.
  it("says why the local model was not available, once it was needed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() =>
      expect(screen.getByText("[server model] no webgpu")).toBeDefined(),
    );
  });

  it("ignores an empty submission", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PortfolioApp />);
    // The send button is disabled until there is something to send.
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the first paint does not depend on the browser", () => {
  // The server has no `navigator`, so any capability read during render makes
  // the server HTML and the first client paint disagree — which is a hydration
  // failure, not a cosmetic one. Comparing the two markups is the cheapest way
  // to hold that line: this exact bug shipped once, because `ModelStatus` asked
  // whether WebGPU existed while rendering.
  it("produces identical markup with and without WebGPU", () => {
    const withoutGpu = renderToString(<PortfolioApp />);

    vi.stubGlobal("navigator", { gpu: {}, userAgent: "test" });
    const withGpu = renderToString(<PortfolioApp />);

    expect(withGpu).toEqual(withoutGpu);
  });

  it("says nothing about the model before the browser has answered", () => {
    expect(renderToString(<PortfolioApp />)).not.toContain("aria-live");
  });
});

describe("asking builds an interface", () => {
  it("renders the Δ the endpoint returns and moves the composer to the top", async () => {
    vi.stubGlobal("fetch", serverReturning("logion", "what is logion"));
    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    // The centred empty state is gone; the composer now sits in a header.
    expect(screen.queryByRole("heading", { name: "What do you want to know?" })).toBeNull();
    expect(screen.getByLabelText("Ask")).toBeDefined();
    expect(screen.getByText(/d1 \/ logion/)).toBeDefined();
  });

  it("a preset asks the same way a typed question does", async () => {
    vi.stubGlobal("fetch", serverReturning("built", "what have you built"));
    render(<PortfolioApp />);
    await userEvent.setup().click(screen.getByRole("button", { name: "What have you built?" }));

    await waitFor(() => expect(screen.getByText(/d1 \/ built/)).toBeDefined());
  });

  it("asks the streaming endpoint first, then the plain one", async () => {
    const fetchMock = serverReturning("logion", "what is logion");
    vi.stubGlobal("fetch", fetchMock);
    render(<PortfolioApp />);
    await ask("what is logion");

    // The stream is tried first because generation is the dominant cost; the
    // plain endpoint is the fallback when it produces nothing usable.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/chat/stream", "/api/chat"]);

    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String(init?.body));
      expect(body.query).toBe("what is logion");
      expect(body.spec.root).toBe("canvas");
    }
  });

  // `offline`, not `deterministic`: the server's deterministic author reads the
  // repository, this last resort cannot, and labelling both the same hid a
  // control-flow bug where every local-model failure landed here silently.
  it("falls back to an offline answer when the endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.getByText(/offline/)).toBeDefined();
  });

  it("falls back when the endpoint returns no transaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ source: "cloud" }), { status: 200 })),
    );
    render(<PortfolioApp />);
    await ask("what is logion");

    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.getByText(/offline/)).toBeDefined();
  });
});

describe("every prompt has a way back", () => {
  it("back returns to the centred chat and forward rebuilds the answer", async () => {
    vi.stubGlobal("fetch", serverReturning("logion", "what is logion"));
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Back to the previous/ }));

    // All the way back is S₀ — the empty state, not an emptied document.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined(),
    );
    expect(screen.queryByText(logion.summary)).toBeNull();

    await user.click(screen.getByRole("button", { name: /Forward to the next/ }));
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
  });

  it("a second question can be walked back to the first, not to nothing", async () => {
    vi.stubGlobal("fetch", serverReturning("logion", "what is logion"));
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    vi.stubGlobal("fetch", serverReturning("contact", "how can I reach you"));
    await ask("how can I reach you");
    await waitFor(() => expect(screen.getByText(contact.summary)).toBeDefined());
    expect(screen.queryByText(logion.summary)).toBeNull();

    await userEvent.setup().click(screen.getByRole("button", { name: /Back to the previous/ }));
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.queryByText(contact.summary)).toBeNull();
  });

  it("asking after going back abandons the branch and leaves no residue", async () => {
    vi.stubGlobal("fetch", serverReturning("logion", "what is logion"));
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Back to the previous/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined(),
    );

    vi.stubGlobal("fetch", serverReturning("contact", "how can I reach you"));
    await ask("how can I reach you");

    await waitFor(() => expect(screen.getByText(contact.summary)).toBeDefined());
    expect(screen.queryByText(logion.summary)).toBeNull();
    expect(screen.getByText(/1 discarded/)).toBeDefined();
    // Nothing ahead to travel to: the branch is gone, not parked.
    expect(screen.getByRole("button", { name: /Forward to the next/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("reset drops the whole journal", async () => {
    vi.stubGlobal("fetch", serverReturning("logion", "what is logion"));
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());

    await userEvent.setup().click(screen.getByRole("button", { name: "reset" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined(),
    );
    expect(screen.queryByRole("button", { name: /Forward to the next/ })).toBeNull();
  });
});

describe("the journal survives a reload", () => {
  it("restores the document and its history", async () => {
    vi.stubGlobal("fetch", serverReturning("logion", "what is logion"));
    const first = render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toContain("logion"));
    first.unmount();

    render(<PortfolioApp />);
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.getByRole("button", { name: /Back to the previous/ })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("discards a corrupted journal instead of crashing", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    render(<PortfolioApp />);
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).not.toBe("{not json"));
    expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined();
  });

  it("ignores a stored Δ that no longer applies", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cursor: 1,
        deltas: [
          {
            id: "d1",
            label: "stale",
            query: "q",
            source: "cloud",
            ops: [{ kind: "attach", parent: "gone", child: "canvas" }],
          },
        ],
      }),
    );
    render(<PortfolioApp />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeDefined(),
    );
  });
});

/**
 * The credit is chrome, not content.
 *
 * A visitor's most likely question about this page is not one the content file
 * is about: where is the code. Asking works, because there is a capsule for it,
 * but the link is in the frame as well, outside the workspace, so no transaction
 * can remove it.
 */
describe("where the code is", () => {
  const SOURCE = "https://github.com/nicolasmelo1/nicolasmelo-portfolio";

  it("is linked before anything has been asked", () => {
    render(<PortfolioApp />);
    expect(screen.getByRole("link", { name: /source/ }).getAttribute("href")).toBe(SOURCE);
    expect(screen.getByRole("link", { name: "Cordis" }).getAttribute("href")).toBe(
      "https://github.com/cordiverse/paper",
    );
  });

  it("is still linked once the page has been rewritten by an answer", async () => {
    vi.stubGlobal("fetch", serverReturning("d1 / logion", "what is logion"));
    render(<PortfolioApp />);
    await ask("what is logion");
    await waitFor(() => expect(screen.getByText(logion.summary)).toBeDefined());
    expect(screen.getByRole("link", { name: /source/ }).getAttribute("href")).toBe(SOURCE);
  });

  it("is answerable too, from the content file rather than from the frame", () => {
    const { capsules } = resolveTurn("how was this built");
    expect(capsules.map((capsule) => capsule.id)).toContain("this-site");
    const site = capsules.find((capsule) => capsule.id === "this-site")!;
    expect(site.links?.map((link) => link.href)).toContain(SOURCE);
  });
});
