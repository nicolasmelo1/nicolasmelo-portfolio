# nicolasmelo-portfolio

A portfolio you talk to.

There is no homepage with sections to scroll through. There is a box where you
type a question. The page then builds itself to answer that question, and it
builds itself again when you ask the next one.

Ask "what have you built" and you get panels about the projects. Say "put them
side by side" and the same panels move next to each other. Say "where have you
worked" and the projects go away and the jobs arrive. If you do not like an
answer, press back and the page returns to exactly what it was.

## How it works

The page is a piece of JSON. It says which boxes exist, what is inside them, and
which box holds which. Nothing more.

When you ask something, a model does not write a web page. It writes a short
list of instructions, like "make a panel called logion-panel", "put this text
inside it", "put that panel on the screen". We call that list a transaction.

Then the program does two things with the list. It carries the instructions out,
and it writes down how to undo each one. That second part is what makes back
work. Going back is not rebuilding the page from scratch. It is running the undo
notes in reverse order, which lands on the exact same page you had before.

```text
                 the empty page (just a question box)
                              |
                     you ask something
                              |
                              v
              +-----------------------------+
              |  a model writes the list:   |
              |  in the browser, or on the  |
              |  server, or a plain         |
              |  fallback if no model can   |
              |  be reached                 |
              +--------------+--------------+
                             |
                             v
                  a list of instructions
                             |
                             v
              +-----------------------------+
              |  the program runs them, and |
              |  writes down how to undo    |
              +--------------+--------------+
                             |
                +------------+------------+
                v                         v
           the new page            the undo notes
```

Because undo is exact, the model is allowed to be wrong. It can try, miss, get
sent back, and try again, and the page carries nothing over from the attempts
that failed. Not a leftover box, not a leftover setting.
`lib/runtime/timeline.test.ts` checks this by running long random sequences of
forward and back moves, comparing the result against a fresh replay every time.

The idea comes from [Cordis](https://github.com/cordiverse/paper), a paper by
Shi, Zhang and Cui about composing things that change over time. The half about
time is what this repository implements, in `lib/runtime/`. The half about space
is not here, because there is only one source of content so far.

The model can propose changes. It cannot change how changes get undone. Keeping
those two apart is the whole reason a model is allowed to fail in the first
place.

**The page never scrolls.** The window is fixed. Anything that does not fit is
not further down, it is simply invisible. So fitting is a puzzle about
arrangement, and the boxes the model is allowed to use are mostly containers:
accordions, tabs, carousels and collapsible sections. It is told to reach for
those instead of writing less. The full list is in `lib/ui/catalog.ts`, and
nothing outside that list exists.

## Conversations

The second question is a different problem from the first one.

"Put them side by side" has no subject of its own. It borrows one from the answer
already on the screen. For a while the server only received the words of the
latest question, so it had to work out the subject from those words alone. That
went badly. The word "them" scored against a job description that happens to
contain the phrase "save against them at runtime", so a question about arranging
four projects fetched an employer instead, and the four projects were wiped to
make room for it.

Now every question is sorted into one of three kinds before anything is fetched:

| kind | what it sounds like | what it has to do |
| --- | --- | --- |
| `replace` | "where have you worked?" | show the new subject, and take the old one off the screen |
| `refine` | "put them side by side", "show me the commit dates" | keep the subject, change how it looks or how deep it goes |
| `extend` | "compare those with where you worked" | hold both subjects at once |

Naming a subject settles it. "How does logion work" is a new question, even
though "how" usually signals a follow-up.

The server keeps no memory of the conversation, and does not need any. Looking up
content is a pure function, so the earlier *questions* are enough to work out the
earlier *subjects*, and the browser already keeps one question per change. It
sends the list along. Questions you have stepped back past are not sent, because
they are not on the screen, so they are not what "them" refers to.

Three sets of tests, because they answer different things:

```bash
npx vitest run lib/conversation.scenario.test.ts           # the pipeline: lookup, author, undo
npx vitest run components/portfolio/multi-turn.test.tsx    # the browser: does it send what the pipeline needs
RUN_LIVE_MODEL=1 npx vitest run app/api/chat/live-model.test.ts   # a real model: does it obey
```

The first two run on every commit. The live one is opt-in and stays out of the
way, because it needs an API key, it costs money, and a model having a bad day
would otherwise fail the build for a reason nobody can fix.

Every conversation test checks the same things on every single turn. The page is
still valid. No box is left created but not placed. The outer box is never
replaced. And the turn is still one press of back away from the turn before it.

## Run

```bash
npm install
npm run dev
```

You can set three things, and all three are optional:

```bash
OPENROUTER_API_KEY=...   # lets a cloud model write the instructions instead of the fallback
OPENROUTER_MODEL=...     # which model. defaults to `openrouter/free`
GITHUB_TOKEN=...         # raises the GitHub read from 60 requests an hour to 5,000
```

Without them the app still works. It just gives simpler answers.

### Which model

`openrouter/free` picks whatever free model is available. Measured at 19 to 87
seconds an answer, sometimes rate limited, sometimes returning a list that does
not parse. A first answer is on screen immediately either way, so the model buys
a better answer, not a faster one.

Model choice matters more than the speed numbers suggest, because a list the
program refuses looks exactly the same as no model at all. Fifteen tries at the
same question, counting how often the result was accepted:

| `OPENROUTER_MODEL` | accepted | per answer | how it failed |
| --- | --- | --- | --- |
| `mistralai/mistral-nemo` | about half | 45 to 75s | boxes nested inside boxes where an id was expected, one reply cut off, one rate limit |
| `anthropic/claude-haiku-4.5` | 3 of 3 | about 10s | it did not |

The smaller model also tried to delete the outer box on every answer it got
right, to change a setting it could have changed directly. The program throws
that instruction away, which is why nobody noticed until it was counted.

### Which GitHub token

It matters more than it looks once the site is live. Without a token GitHub
allows 60 requests an hour *per address*, every visitor shares the server's
address, and reading one repository costs four requests. That is about fifteen
repository reads an hour for everyone put together.

The reading happens on the server, never in the browser. It used to happen in the
browser, which spent each visitor's own allowance, could not share what had
already been fetched, and printed a red error in their console every time GitHub
said no.

### The model in the browser

It starts loading as soon as the page opens, so it is usually ready before anyone
asks anything. It is `Llama-3.2-1B-Instruct` through WebLLM, which is 672 MB to
download, with `Qwen3-0.6B` (335 MB) tried once if that fails to start.

The bigger one is the default on purpose. Writing a correct list of instructions
is the hard part, and the trick that would let a smaller model do it reliably is
broken in web-llm 0.2.84. See `buildChatRequest`.

Two numbers are pinned by tests. web-llm insists on a 4,096 token window, and
this app asks for 12,288, because the instructions do not fit in 4,096 and every
answer failed quietly until it did. And no model is chosen whose own window is
smaller than that, however cheap it looks.

The worker is bundled ahead of time by `npm run build:worker`. Referring to it
inline instead was worse than it sounds: Turbopack did not recognise it as a
worker, served the raw TypeScript as a video file, and failed without saying
anything.

`lib/llm/models.ts` records every candidate model with measured numbers and both
of its window sizes, because size and release date were not enough to pick by.
The previous default won on every published number and could not start at all.
`npm run verify:models` checks that list against web-llm and Hugging Face, and
the build fails if that check ever stops running.

Loading is skipped when it would be rude: no WebGPU, data saver turned on, or a
2g or 3g connection. Those visitors get the server instead, and the only
difference they can notice is that it takes longer.

## Checks

This repository is governed by
[software-factory](https://github.com/nicolasmelo1/software-factory). Every rule
is both enforced by a check and explained in plain words in
[docs/rules.md](docs/rules.md). The answers that generated the repository
specific rules are in `.software-factory/answers.yaml`, and the decisions they
imply are written down in
[docs/architecture-decisions.md](docs/architecture-decisions.md).

```bash
sf verify     # prove every rule still catches the thing it is meant to catch
sf check      # what is wrong in this repository right now
npm test      # unit and component tests, including the conversations
npm run bench # the speed guard
npm run knip  # finds code nothing reaches
npm run lint  # includes a security plugin
```

`sf verify` always runs before `sf check`, both in CI and in
`.githooks/pre-commit`, because a check that quietly stopped working makes every
run after it meaningless. Turn the hook on once with
`git config core.hooksPath .githooks`.

## Deploy

The same workflow that checks the code also ships it. The `deploy` job in
`.github/workflows/software-factory.yml` waits for all three check jobs and only
runs on a push to `main`.

Vercel's own git integration is switched off on purpose. It deploys the moment a
commit lands, which is before any check has had a chance to fail.

The build happens on the GitHub runner, and `vercel deploy --prebuilt` uploads
only the built output. The source never leaves the runner and nothing is built
twice. Three repository secrets are needed: `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID`. They are read from the environment instead of being passed
on the command line, which would leave the token sitting in the runner's list of
running processes.

The app's own settings (`OPENROUTER_API_KEY`, `GITHUB_TOKEN`) belong to the
Vercel project rather than to this repository's secrets, because the running site
is what needs them. `vercel pull` fetches them at build time.

## Content

Everything the site can say about Nicolas lives in `content/portfolio.ts`: the
jobs, the projects, the studies, the skills and the links.

That file is the only source of facts. The model is handed pieces of it and told
it may not invent anything, so whatever is missing from that file simply cannot
be said. Adding a job or a project means editing that one file. The renderer does
not change.
