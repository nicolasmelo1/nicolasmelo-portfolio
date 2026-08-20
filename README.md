# nicolasmelo-portfolio

A text-only interactive portfolio. The page is a persistent `json-render` spec: each question receives the current spec, edits it, and the resulting JSON becomes the new page.

## Architecture

The page is not a document that gets rewritten. It is a workspace that gets
*transformed*, and every transformation carries its own inverse.

```text
                    S₀  (empty — a centred chat)
                     |
              user intent
                     |
                     v
        +---------------------------+
        |  local model (WebWorker)  |  574 MB, auto-loaded in the background
        |  or /api/chat             |  server route while the weights arrive
        |  or deterministic         |  no model reachable
        +-------------+-------------+
                      |
                      v
                  Δ = [op, op, ...]     register / unregister / attach /
                      |                 detach / patchProps / dropProps / setRoot
                      v
        +---------------------------+
        |  kernel: applyOps         |  returns the next state AND the inverse
        +-------------+-------------+
                      |
              +-------+-------+
              v               v
            S₁          journal entry {Δ, inverse}
```

The model never writes JSX, HTML, CSS or a whole document — it proposes a Δ, a
list of typed operations over the workspace. The kernel applies it and derives
the inverse from the state the op was applied to, so `back` runs inverses in
LIFO order rather than rebuilding anything. That makes going back exact, which
in turn makes it safe to let a probabilistic author try, fail and retry:

```text
S₁ ──Δ compact──> ✗ back ──Δ list──> ✗ back ──Δ dense──> S₂
```

The rejected branches leave nothing behind — not an orphan node, not a stale
prop. `lib/runtime/timeline.test.ts` checks that against seeded random walks of
commit/back/forward, asserting after every step that the live state equals a
fresh replay of the surviving Δ.

This follows [Cordis](https://github.com/cordiverse/paper), *A Programming
Paradigm for Spatiotemporal Composability* (Shi, Zhang, Cui). Its temporal
half — an effect paired with an explicit inverse that the runtime tracks — is
what is implemented here, in `lib/runtime/`. Its spatial half (coeffects,
providers, dependency reconciliation) is not: this repository has one static
content source, so there is nothing for a reconciler to be about yet.

**The page never scrolls.** The viewport is fixed, so a Δ that does not fit is
invisible rather than reachable. Fitting is therefore a compositional problem,
and the component vocabulary in `lib/ui/catalog.ts` is mostly containers —
Accordion, Tabs, Carousel, Collapsible — which the model is told to reach for
instead of writing less. What it can render is exactly that catalog and nothing
else.

The kernel is the one thing the model cannot touch. It proposes Δ; it does not
get to edit how Δ are reverted.

## Run

```bash
npm install
npm run dev
```

Optional environment:

```bash
OPENROUTER_API_KEY=...   # lets a cloud model author the Δ instead of the fallback
GITHUB_TOKEN=...         # raises the repository read from 60 requests/hour to 5,000
npm run dev
```

Both are optional and the app degrades rather than failing without them. The
token matters more than it looks on a deployed site: unauthenticated GitHub
allows 60 requests an hour *per address*, every visitor shares the server's
address, and one repository costs four requests — about fifteen reads an hour
for everyone combined.

The repository read happens on the server, never in the browser. It used to run
client-side, which spent each visitor's own quota, could not share the cache, and
printed a 403 into their console for every refused call.

The local model loads itself in a WebWorker as soon as the page opens, so it is
usually ready before anyone asks anything. It is `Llama-3.2-1B-Instruct` through
WebLLM — 672 MB to download — with `Qwen3-0.6B` (335 MB) tried once if it fails
to initialise. The bigger model is the default on purpose: authoring a typed
transaction is the hard part, and the grammar-constrained decoding that would
have let a 0.6B model do it reliably is broken in web-llm 0.2.84 (see
`buildChatRequest`).

Two numbers govern it, both enforced by tests. web-llm forces a 4,096-token
context window; this app requests 12,288, because the prompt does not fit 4,096
and every local answer silently failed until it did. And no model is selected
whose native window is smaller than that, however cheap it is.

The worker is pre-bundled by `npm run build:worker` rather than referenced as
`new Worker(new URL("./worker.ts", …))`: Turbopack did not treat the inline form
as a worker entry and served the raw TypeScript as `video/mp2t`, which fails
silently.

`lib/llm/models.ts` records every candidate with measured numbers *and* both of
its window sizes, because size and recency turned out to be insufficient — the
previous default won on every published number and could not start at all.
`npm run verify:models` re-checks the registry against web-llm and Hugging Face,
and `L6.BROWSER_MODEL_CONFIG_IS_VERIFIED` fails the build if that check stops
running.

Auto-loading is guarded: no WebGPU, `saveData` set, or a 2g/3g connection and
the download never starts. Those visitors get the server route, and the only
difference they can notice is latency.

## Checks

This repository is governed by [software-factory](https://github.com/nicolasmelo1/software-factory).
Every rule is enforced by a check and explained in [docs/rules.md](docs/rules.md);
the interview answers that generated the repo-specific rules are in
`.software-factory/answers.yaml`, and the decisions they imply are recorded in
[docs/architecture-decisions.md](docs/architecture-decisions.md).

```bash
sf verify     # prove every enabled rule still fires on its fixture
sf check      # what is live in this repository right now
npm test      # unit + component tests (vitest, jsdom)
npm run bench # the L6 performance guard
npm run knip  # the L6 dead-code detector
npm run lint  # includes eslint-plugin-security
```

`sf verify` runs before `sf check` everywhere — in CI and in `.githooks/pre-commit` —
because a check that quietly stopped firing makes the run after it meaningless.
Enable the hook once with `git config core.hooksPath .githooks`.

## Content

Portfolio data lives in `content/portfolio.ts`. The current seed uses public GitHub projects and is intentionally small; CV/work-history capsules can be added without changing the renderer.
