import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portfolioCapsules } from "@/content/portfolio";
import { resolveTurn, sanitizeHistory } from "@/lib/conversation";
import { checkedDeterministicDelta } from "@/lib/ui/delta";
import type { initialSpec } from "@/lib/ui/spec";

/**
 * Multi-turn, through the component the visitor actually uses.
 *
 * `lib/conversation.scenario.test.ts` proves the pipeline resolves a follow-up
 * correctly. It cannot prove the browser *sends* what the pipeline needs, and
 * that was the missing half: the client had the previous questions in its
 * journal all along and posted only the current one. So this drives the real
 * form, turn after turn, and asserts both the document on screen and the
 * requests that produced it.
 */

vi.mock("@/lib/llm/browser", () => ({
  autoLoadSkipReason: () => "no-webgpu",
  localModelStarted: () => false,
  startLocalModel: async () => ({}),
  activeModel: () => null,
  interruptLocalModel: () => {},
  generateDeltaInBrowser: async () => null,
}));

const { PortfolioApp } = await import("@/components/portfolio/portfolio-app");

const projects = portfolioCapsules.filter((capsule) => capsule.kind === "project");
const employers = portfolioCapsules.filter((capsule) => capsule.kind === "experience");

type Sent = { query: string; history?: unknown; spec: typeof initialSpec };

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Ask"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

function canvas() {
  return document.querySelector(".jr-canvas");
}

/** Every request body the client posted, in order, to whichever endpoint. */
function recorder(handle: (sent: Sent, url: string) => Response) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Sent;
      sent.push(body);
      return handle(body, String(url));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { sent, fetchMock };
}

/** Nothing reachable: the answer on screen is the one this browser authored. */
function offline() {
  return recorder(() => new Response("nope", { status: 500 }));
}

/**
 * A stand-in for the route that runs the route's own logic — resolved against
 * the history the client posted, authored against the spec the client posted.
 * Anything the client fails to send, this fails to use, which is the point.
 */
function server() {
  return recorder((sent, url) => {
    if (url.includes("/stream")) return new Response("no stream here", { status: 500 });
    const history = sanitizeHistory(sent.history);
    const { intent, capsules } = resolveTurn(sent.query, history);
    const delta = checkedDeterministicDelta(sent.spec, sent.query, capsules, {}, intent);
    return new Response(JSON.stringify({ delta, source: "cloud" }), { status: 200 });
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a second question about the first answer", () => {
  it("arranges what is on screen instead of replacing it", async () => {
    offline();
    render(<PortfolioApp />);

    await ask("show me your projects");
    await waitFor(() => expect(screen.getByText(projects[0].title)).toBeDefined());
    expect(canvas()?.className).toContain("flex-col");

    await ask("put them side by side");
    // Still there — this is the turn that used to wipe them.
    await waitFor(() => expect(canvas()?.className).toContain("flex-row"));
    for (const project of projects.slice(0, 3)) {
      expect(screen.getByText(project.title), project.id).toBeDefined();
    }
    // And no employer arrived in their place, which is what `them` used to
    // retrieve.
    expect(screen.queryByText(employers[0].title)).toBeNull();
  });

  it("sends the questions that came before it", async () => {
    const { sent } = server();
    render(<PortfolioApp />);

    await ask("show me your projects");
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent[0].history).toEqual([]);

    await ask("put them side by side");
    await waitFor(() => expect(sent.length).toBeGreaterThan(2));
    expect(sent.at(-1)?.history).toEqual(["show me your projects"]);
    expect(sent.at(-1)?.query).toBe("put them side by side");
  });

  it("still changes subject when the visitor changes it", async () => {
    server();
    render(<PortfolioApp />);

    await ask("show me your projects");
    await waitFor(() => expect(screen.getByText(projects[0].title)).toBeDefined());

    await ask("where have you worked?");
    // The destructive turn: the employers arrive and the projects leave.
    await waitFor(() => expect(screen.getByText(employers[0].title)).toBeDefined());
    for (const project of projects) {
      expect(screen.queryByText(project.title), project.id).toBeNull();
    }
  });

  it("does not carry a question the visitor has stepped back past", async () => {
    const { sent } = server();
    render(<PortfolioApp />);

    await ask("show me your projects");
    await waitFor(() => expect(screen.getByText(projects[0].title)).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Back to the previous/ }));

    await ask("where have you worked?");
    await waitFor(() => expect(screen.getByText(employers[0].title)).toBeDefined());
    // Rewound past it, so it is not on screen and not what a pronoun would
    // point at. Sending it would resolve the next turn against a view nobody is
    // looking at.
    expect(sent.at(-1)?.history).toEqual([]);
  });
});
