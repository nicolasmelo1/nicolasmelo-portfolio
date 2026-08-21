// @vitest-environment node
import type { Spec } from "@json-render/core";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/chat/route";
import { applyOps, type Op } from "@/lib/runtime/ops";
import { initialSpec, parsePortfolioSpec, ROOT_ID } from "@/lib/ui/spec";

/**
 * The conversation, against a real model.
 *
 * Everything else about multi-turn is deterministic and pinned by
 * `lib/conversation.scenario.test.ts` and `components/portfolio/multi-turn.test.tsx`.
 * The one thing neither can answer is whether a model, handed this prompt, this
 * `intent` and this conversation, actually *obeys* — whether "refine" produces
 * an edit and "replace" produces a replacement.
 *
 * Opt-in and out of the gate: it needs a key and it costs money.
 *
 *     RUN_LIVE_MODEL=1 OPENROUTER_API_KEY=... npx vitest run app/api/chat/live-model.test.ts
 *
 * ## What it does and does not assert
 *
 * It asserts invariants, never wording or structure. "Did the projects survive
 * the turn that was supposed to rearrange them" is checkable; "did it choose
 * Tabs" is not, and pinning it would only punish a model for being creative in a
 * way the catalog already permits.
 *
 * It also does not assert that the model succeeds. It cannot: the author is
 * probabilistic and the rate is a property of the configured model, not of this
 * code. Measured on the same first-turn question, fifteen samples:
 *
 *     mistralai/mistral-nemo      ~50% accepted   45-75s   nested nodes inside
 *                                                          `children`; one reply
 *                                                          truncated; one 429
 *     anthropic/claude-haiku-4.5   3/3 accepted   ~10s     15 ops, and the only
 *                                                          one that left the root
 *                                                          alone
 *
 * So a suite that required three model-authored turns in a row would fail about
 * a third of the time against the configured model while the code under test was
 * perfectly fine — a red build nobody can act on, which is exactly what this
 * file must not produce. Instead: retry each turn, require that the model
 * authored *something* across the conversation, and check obedience only on the
 * turns it actually authored. A model that never gets through in nine attempts
 * is a real finding, and the message says so rather than blaming multi-turn.
 */

const live = process.env.RUN_LIVE_MODEL === "1" && Boolean(process.env.OPENROUTER_API_KEY);
const ATTEMPTS = 3;

type Attempt = { spec: Spec; source: string; authored: boolean };

async function attempt(query: string, spec: Spec, history: string[]): Promise<Attempt> {
  const response = await POST(
    new Request("http://local/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, spec, history }),
    }),
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    delta?: { label: string; ops: Op[] };
    source?: string;
  };

  // These hold whoever authored it, which is the point of the gate: the route
  // is not allowed to return a transaction that does not apply or does not
  // render, however badly the model behaved.
  expect(payload.delta?.ops.length, `${query}: the transaction is empty`).toBeGreaterThan(0);
  const next = applyOps(spec, payload.delta!.ops).next;
  expect(parsePortfolioSpec(next), `${query}: the finished document is renderable`).not.toBeNull();

  const source = payload.source ?? "deterministic";
  return { spec: next, source, authored: source === "cloud" };
}

/** One turn, with up to three chances at getting the model to author it. */
async function turn(query: string, spec: Spec, history: string[]) {
  let last = await attempt(query, spec, history);
  for (let i = 1; i < ATTEMPTS && !last.authored; i += 1) {
    last = await attempt(query, spec, history);
  }
  return last;
}

const bodyIds = (spec: Spec) => Object.keys(spec.elements).filter((id) => id !== ROOT_ID);

/** How much of the previous answer is still standing, as a fraction. */
function survival(before: string[], after: string[]) {
  if (!before.length) return 1;
  return before.filter((id) => after.includes(id)).length / before.length;
}

describe.skipIf(!live)("a real model, across three turns", () => {
  it(
    "rearranges on a refinement and replaces on a new question",
    async () => {
      const first = await turn("show me your projects", initialSpec, []);
      const projects = bodyIds(first.spec);
      expect(projects.length).toBeGreaterThan(0);

      const second = await turn("put them side by side", first.spec, ["show me your projects"]);
      if (second.authored) {
        // A fraction, not equality: rearranging may legitimately drop a node,
        // and a model that reworks the containers while keeping the content has
        // still done what was asked. Losing most of it has not.
        expect(
          survival(projects, bodyIds(second.spec)),
          "the refinement rebuilt the view instead of rearranging it",
        ).toBeGreaterThan(0.5);
      }

      const third = await turn("where have you worked?", second.spec, [
        "show me your projects",
        "put them side by side",
      ]);
      if (third.authored) {
        // The destructive turn. Anything left from the projects is residue: the
        // visitor changed subject, and scrolling past the old one is not an
        // answer to the new one.
        expect(
          survival(bodyIds(second.spec), bodyIds(third.spec)),
          "the new question left the old subject on screen",
        ).toBeLessThan(0.5);
      }

      const authored = [first, second, third].filter((t) => t.authored).length;
      expect(
        authored,
        `the configured model authored none of the three turns in ${ATTEMPTS} attempts each. ` +
          "That is a model or prompt compliance problem, not a multi-turn one — check " +
          "OPENROUTER_MODEL before looking at lib/conversation.ts.",
      ).toBeGreaterThan(0);
    },
    // Nine attempts worst case, measured at 10 to 75 seconds each.
    12 * 60 * 1000,
  );
});
