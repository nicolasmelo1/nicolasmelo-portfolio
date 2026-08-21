"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "@/components/portfolio/registry";
import {
  generateDeltaInBrowser,
  interruptLocalModel,
  localModelStarted,
  activeModel,
  autoLoadSkipReason,
  startLocalModel,
  type LoadPhase,
  type SkipReason,
} from "@/lib/llm/browser";
import { collectStreamedDelta } from "@/lib/llm/stream-client";
import { resolveTurn } from "@/lib/conversation";
import {
  back,
  canGoBack,
  canGoForward,
  commitChecked,
  createTimeline,
  replaceHead,
  forward,
  head,
  reset,
  type Delta,
  type Source,
  type Timeline,
} from "@/lib/runtime/timeline";
import { BROWSER_MODELS, DEFAULT_MODEL } from "@/lib/llm/models";
import { withViewTransition } from "@/lib/ui/animate";
import { checkedDeterministicDelta } from "@/lib/ui/delta";
import { initialSpec } from "@/lib/ui/spec";

const STORAGE_KEY = "nicolasmelo.portfolio.journal.v2";

const PRESETS = [
  "Where do you work?",
  "Walk me through your experience",
  "What have you built?",
  "What do you work with?",
  "How can I reach you?",
];

type Stored = { deltas: Delta[]; cursor: number };

/** Rebuild a timeline from a stored journal, dropping anything that no longer applies. */
function restore(stored: Stored): Timeline {
  let timeline = createTimeline(initialSpec);
  for (const delta of stored.deltas) {
    // A Δ authored against an older catalog is simply not replayed. The journal
    // is a record of intent, not a migration.
    const next = commitChecked(timeline, delta);
    if (!next) break;
    timeline = next;
  }
  const target = Math.min(stored.cursor, timeline.entries.length);
  while (timeline.cursor > target) timeline = back(timeline);
  return timeline;
}

/**
 * The questions asked before now, oldest first.
 *
 * Only the applied ones. After `back`, the Δ ahead of the cursor are not on
 * screen — so they are not what "them" in the next question refers to, and
 * including them would resolve a follow-up against a view nobody is looking at.
 */
function questionsSoFar(timeline: Timeline) {
  return timeline.entries.slice(0, timeline.cursor).map((entry) => entry.delta.query);
}

type Inference = {
  status: "idle" | "running" | "stopped" | "settled";
  query: string | null;
  by: Source | null;
};

/** What a refinement needs in order to replace the provisional answer. */
type Inflight = {
  token: number;
  question: string;
  /** The document as it was *before* the provisional Δ. */
  spec: Timeline["current"];
  /** Where the cursor sat once the provisional Δ was committed. */
  cursor: number;
  /** The questions asked before this one, as the provisional answer saw them. */
  history: string[];
  controller: AbortController;
};

export function PortfolioApp() {
  const [timeline, setTimeline] = useState<Timeline>(() => createTimeline(initialSpec));
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("deterministic");
  const [inference, setInference] = useState<Inference>({ status: "idle", query: null, by: null });
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [status, setStatus] = useState("");
  const [skipped, setSkipped] = useState<SkipReason | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  /**
   * The document being assembled by a stream.
   *
   * Staging, not committing. The timeline never holds a half-applied
   * transaction, so "the last valid state" is whatever is committed — and
   * abandoning a stream is dropping this, with no inverse to run.
   */
  const [staged, setStaged] = useState<Timeline["current"] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The timeline is read from inside async callbacks that outlive the render
  // they started in, so a ref carries the current value alongside the state.
  const timelineRef = useRef(timeline);
  const tokenRef = useRef(0);
  const inflightRef = useRef<Inflight | null>(null);

  function setTimelineNow(next: Timeline) {
    timelineRef.current = next;
    setTimeline(next);
  }

  useEffect(() => {
    // localStorage does not exist during SSR, so this has to run after mount.
    // Reading it in a state initialiser would render a different tree on the
    // server than on the client and break hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only read, see above
    setHydrated(true);

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const restored = restore(JSON.parse(saved) as Stored);
        timelineRef.current = restored;
        setTimeline(restored);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    // Nothing about the model happens here. It used to auto-load on mount,
    // which spent 672 MB and a shader compilation on every visit for a model
    // that only answers when the cloud cannot.
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const stored: Stored = {
      deltas: timeline.entries.map((entry) => entry.delta),
      cursor: timeline.cursor,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [hydrated, timeline]);

  /** Abandon whatever inference is in flight. Safe to call when there is none. */
  function cancelInflight() {
    inflightRef.current?.controller.abort();
    inflightRef.current = null;
    interruptLocalModel();
    // Dropping the staged document is the whole rollback: nothing partial ever
    // reached the journal.
    setStaged(null);
  }

  const stale = (token: number) => tokenRef.current !== token;

  function travel(next: Timeline) {
    // Navigating invalidates a refinement: it was authored to replace a
    // provisional answer that is no longer the one on screen.
    cancelInflight();
    tokenRef.current += 1;
    setInference({ status: "idle", query: null, by: null });
    withViewTransition(() => setTimelineNow(next));
  }

  /**
   * Answer immediately, then improve.
   *
   * The deterministic author runs first and synchronously, so a question always
   * produces a page straight away and the composer is never disabled. The model
   * is a *refinement*: when it answers, the provisional Δ is undone and the real
   * one applied in its place, which is what keeps the journal at one Δ per
   * question. The kernel already had to be able to take a Δ back; this is the
   * same mechanism used forwards.
   */
  function ask(raw: string) {
    const question = raw.trim();
    if (!question) return;

    cancelInflight();
    setQuery("");

    const spec = timelineRef.current.current;
    // Read before committing, so it is the conversation *before* this question.
    const history = questionsSoFar(timelineRef.current);
    // The instant answer resolves the same way the server will. Without this it
    // was the destructive one: "put them side by side" cleared the four projects
    // it was asked to arrange, and the model's version arrived seconds later to
    // an empty canvas.
    const { intent, capsules } = resolveTurn(question, history);
    const provisional = checkedDeterministicDelta(spec, question, capsules, {}, intent);
    const committed = commitChecked(timelineRef.current, {
      id: `d${timelineRef.current.entries.length + 1}`,
      query: question,
      // `offline`: authored here, instantly, with no model and no repository
      // read. The route's own fallback is `deterministic` and carries both.
      source: "offline",
      ...provisional,
    });
    if (!committed) return;

    withViewTransition(() => {
      setTimelineNow(committed);
      setSource("offline");
    });
    inputRef.current?.focus();

    const token = (tokenRef.current += 1);
    inflightRef.current = {
      token,
      question,
      spec,
      cursor: committed.cursor,
      history,
      controller: new AbortController(),
    };
    setInference({ status: "running", query: question, by: null });
    void refine(token);
  }

  /** Replace the provisional Δ with a better one, if it is still the one on screen. */
  function replaceProvisional(delta: { label: string; ops: Delta["ops"] }, by: Source, token: number) {
    const inflight = inflightRef.current;
    if (!inflight || stale(token)) return false;
    // The visitor walked somewhere else: the refinement no longer belongs here.
    if (timelineRef.current.cursor !== inflight.cursor) return false;

    const next = replaceHead(timelineRef.current, {
      id: `d${timelineRef.current.cursor}`,
      query: inflight.question,
      source: by,
      ...delta,
    });
    if (!next) return false;

    withViewTransition(() => {
      setTimelineNow(next);
      setSource(by);
    });
    return true;
  }

  async function refine(token: number) {
    const inflight = inflightRef.current;
    if (!inflight) return;
    const { question, spec, controller, history } = inflight;

    const settle = (by: Source) =>
      setInference((current) =>
        current.query === question ? { status: "settled", query: question, by } : current,
      );

    // Streamed first. Generation is 11 to 87 seconds depending on the model,
    // and the ops inside a transaction are independent and ordered, so the
    // interface can assemble itself while the model is still writing.
    const streamed = await streamFromServer(question, spec, history, controller.signal, token);
    if (stale(token)) return;
    if (streamed) return settle("cloud");

    const cloud = await askServer(question, spec, history, controller.signal);
    if (stale(token)) return;

    if (cloud) {
      // Applied the moment it lands, whatever authored it. The route's own
      // fallback still carries the repository read that the provisional answer
      // built in this browser could not, so it is already an improvement.
      //
      // Waiting for the local model before showing this was the bug behind
      // "the endpoint returned 200 and the page did not change": with no API
      // key the route answers `deterministic`, and the old order downloaded
      // 672 MB before rendering it.
      replaceProvisional(cloud.delta, cloud.source, token);
      if (cloud.source === "cloud") return settle("cloud");
      settle(cloud.source);
    }

    // The route had no model of its own — no key, provider down, rate limited.
    // A local model beats the fallback author, so it is worth loading now that
    // something is already on screen.
    setInference((current) =>
      current.query === question ? { status: "running", query: question, by: null } : current,
    );
    const local = await askLocal(question, spec, history, token);
    if (stale(token)) return;
    if (local && replaceProvisional(local, "local", token)) return settle("local");

    settle(cloud?.source ?? "offline");
  }

  /**
   * Stream the model's transaction, applying each op as it closes.
   *
   * Returns true when a whole transaction arrived and was committed. Anything
   * else — no key, a refused op, a truncated body — leaves the provisional
   * answer exactly as it was and lets the caller try something else.
   */
  async function streamFromServer(
    question: string,
    spec: Timeline["current"],
    history: string[],
    signal: AbortSignal,
    token: number,
  ): Promise<boolean> {
    let collected;
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, spec, history }),
        signal,
      });
      if (!response.ok) return false;

      collected = await collectStreamedDelta(response, spec, {
        isStale: () => stale(token),
        onProgress: setStaged,
      });
    } catch {
      // Aborted, or the connection died mid-transaction.
      setStaged(null);
      return false;
    }

    if (stale(token) || !collected.finished || !collected.ops.length) {
      // Dropping the staging is the whole rollback: nothing partial ever
      // reached the journal.
      setStaged(null);
      return false;
    }

    const committed = replaceProvisional(
      { label: collected.label ?? question, ops: collected.ops },
      "cloud",
      token,
    );
    setStaged(null);
    return committed;
  }

  /** Ask the route. Returns null when it could not be reached, or was cancelled. */
  async function askServer(
    question: string,
    spec: Timeline["current"],
    history: string[],
    signal: AbortSignal,
  ) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, spec, history }),
        signal,
      });
      if (!response.ok) throw new Error(`chat endpoint returned ${response.status}`);

      const payload = (await response.json()) as {
        delta?: { label?: string; ops?: Delta["ops"] };
        source?: Source;
      };
      if (!payload.delta?.ops?.length || !payload.delta.label) {
        throw new Error("endpoint returned no transaction");
      }
      return {
        delta: { label: payload.delta.label, ops: payload.delta.ops },
        source: payload.source ?? "deterministic",
      };
    } catch (error) {
      if (signal.aborted) return null;
      console.warn("[cloud] unavailable", error);
      return null;
    }
  }

  /**
   * Ask the local model, loading it on demand.
   *
   * Lazy on purpose: downloading 672 MB and compiling shaders on every visit is
   * hard to justify for a model that only answers when the cloud cannot.
   */
  async function askLocal(
    question: string,
    spec: Timeline["current"],
    history: string[],
    token: number,
  ) {
    const skip = autoLoadSkipReason();
    if (skip) {
      // Worth saying only now: the cloud already failed, so this is why there
      // is no second chance.
      setPhase("unavailable");
      setSkipped(skip);
      return null;
    }

    try {
      if (!localModelStarted()) {
        setPhase("loading");
        await startLocalModel((message) => setStatus(message));
        if (stale(token)) return null;
        setPhase("ready");
        setStatus("");
        setLoaded(activeModel());
      }
      return await generateDeltaInBrowser(question, spec, history);
    } catch (error) {
      console.warn("[local model] could not author a Δ", error);
      setPhase("unavailable");
      setStatus(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Back, with a stream in flight, means "the last valid state" — which is the
   * one before the stream started, not the one before the question. A partial
   * transaction is not a checkpoint, so there is nothing to step through.
   */
  function goBack() {
    if (staged) {
      stopInference();
      return;
    }
    travel(back(timeline));
  }

  function stopInference() {
    const inflight = inflightRef.current;
    if (!inflight) return;
    cancelInflight();
    tokenRef.current += 1;
    setInference({ status: "stopped", query: inflight.question, by: null });
  }

  /**
   * Run the refinement again for the answer currently on screen.
   *
   * Only offered while that answer is still the head of the journal, because a
   * refinement replaces the Δ at the cursor and nothing else.
   */
  function resumeInference() {
    const current = head(timelineRef.current);
    if (!current) return;

    const rolled = back(timelineRef.current);
    const token = (tokenRef.current += 1);
    inflightRef.current = {
      token,
      question: current.query,
      spec: rolled.current,
      cursor: timelineRef.current.cursor,
      // Everything before the answer being retried, which is what `rolled` is.
      history: questionsSoFar(rolled),
      controller: new AbortController(),
    };
    setInference({ status: "running", query: current.query, by: null });
    void refine(token);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(query);
  }

  const empty = timeline.cursor === 0;
  const current = head(timeline);
  const running = inference.status === "running";
  const stopped = inference.status === "stopped";
  // Worth offering a retry when the model never got to author: either the
  // visitor stopped it, or it settled on an answer no model wrote.
  const canResume =
    !!current &&
    (stopped || (inference.status === "settled" && inference.by !== "cloud" && inference.by !== "local"));

  const composer = (
    <form onSubmit={submit} className="jr-composer">
      <label htmlFor="portfolio-query" className="jr-prompt">
        visitor&gt;
      </label>
      <input
        ref={inputRef}
        id="portfolio-query"
        name="query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="ask about projects, experience, architecture, tooling..."
        autoComplete="off"
        aria-label="Ask"
        className="jr-input"
      />
      <button type="submit" disabled={!query.trim()} aria-label="Send" className="jr-key">
        [ enter ]
      </button>
    </form>
  );

  const history = (
    <span className="jr-keys">
      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack(timeline)}
        aria-label="Back to the previous interface"
        className="jr-key"
      >
        [ &lt; back ]
      </button>
      <button
        type="button"
        onClick={() => travel(forward(timeline))}
        disabled={!canGoForward(timeline)}
        aria-label="Forward to the next interface"
        className="jr-key"
      >
        [ forward &gt; ]
      </button>
    </span>
  );

  if (empty) {
    return (
      <main className="jr-shell jr-centre">
        <div className="jr-column">
          <pre aria-hidden="true" className="jr-rule">
            {"+-------------------------[ NICOLAS MELO ]-------------------------+"}
          </pre>
          <h1 className="jr-heading">What do you want to know?</h1>
          {composer}
          <div className="jr-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => ask(preset)}
                aria-label={preset}
                className="jr-key"
              >
                [ {preset} ]
              </button>
            ))}
          </div>
          <pre aria-hidden="true" className="jr-rule">
            {"+------------------------------------------------------------------+"}
          </pre>
          <p className="jr-note">
            every answer rewrites this page. every change can be walked back.
          </p>
          <SiteCredit />
          {canGoForward(timeline) ? <div className="jr-presets">{history}</div> : null}
        </div>
        <ModelStatus phase={phase} status={status} skipped={skipped} loaded={loaded} />
      </main>
    );
  }

  return (
    <main className="jr-shell">
      <header className="jr-header">
        <div className="jr-header-row">
          <div className="jr-min jr-grow">{composer}</div>
          {history}
          <button
            type="button"
            onClick={() => travel(reset(timeline))}
            aria-label="reset"
            className="jr-key"
          >
            [ reset ]
          </button>
        </div>
        <div className="jr-note-row">
          <p className="jr-note jr-truncate">
            {`d${timeline.cursor}`}
            {current ? ` / ${current.label}` : ""}
            {` / ${source}`}
            {timeline.discarded.length ? ` / ${timeline.discarded.flat().length} discarded` : ""}
          </p>
          <RefinementStatus
            running={running}
            stopped={stopped}
            canResume={canResume}
            onStop={stopInference}
            onResume={resumeInference}
          />
        </div>
      </header>

      <div className="jr-workspace">
        <JSONUIProvider registry={registry}>
          <Renderer spec={staged ?? timeline.current} registry={registry} />
        </JSONUIProvider>
      </div>

      <SiteCredit />
      <ModelStatus phase={phase} status={status} skipped={skipped} loaded={loaded} />
    </main>
  );
}

/**
 * Where this page came from.
 *
 * The site answers questions about Nicolas, and the question a developer is
 * most likely to have about it is not one of those: how it works, and where the
 * code is. Asking works, because `content/portfolio.ts` carries a capsule for
 * this repository. This is the version for people who would rather click, and it
 * is chrome rather than content, so no model can remove it.
 */
function SiteCredit() {
  return (
    <p className="jr-credit">
      <a
        href="https://github.com/nicolasmelo1/nicolasmelo-portfolio"
        target="_blank"
        rel="noreferrer"
        className="jr-key"
      >
        [ source ]
      </a>{" "}
      <span className="jr-faint">inspired by</span>{" "}
      <a
        href="https://github.com/cordiverse/paper"
        target="_blank"
        rel="noreferrer"
        className="jr-link"
      >
        Cordis
      </a>
    </p>
  );
}

/**
 * Whether a better answer is still coming, and how to stop waiting for it.
 *
 * Stated rather than implied: the answer on screen is already usable, so the
 * only question left is whether it is the final one.
 */
function RefinementStatus({
  running,
  stopped,
  canResume,
  onStop,
  onResume,
}: {
  running: boolean;
  stopped: boolean;
  canResume: boolean;
  onStop: () => void;
  onResume: () => void;
}) {
  if (running) {
    return (
      <p className="jr-note">
        <span className="jr-working">... refining</span>{" "}
        <button type="button" onClick={onStop} aria-label="Stop the model" className="jr-key">
          [ stop ]
        </button>
      </p>
    );
  }

  if (!canResume) return null;

  return (
    <p className="jr-note">
      {stopped ? "stopped" : "model did not answer"}{" "}
      <button type="button" onClick={onResume} aria-label="Ask the model again" className="jr-key">
        [ resume ]
      </button>
    </p>
  );
}

const SKIP_LABEL: Record<SkipReason, string> = {
  "no-webgpu": "no webgpu",
  "data-saver": "data saver on",
  // Derived from the registry so the figure cannot drift from the model in use.
  "slow-connection": `connection too slow for ${DEFAULT_MODEL.downloadMB} MB`,
};

/**
 * Rendered from props alone. An earlier version asked the browser whether
 * WebGPU existed while rendering, which the server cannot answer the same way —
 * so the server emitted this line and the client did not, and hydration failed.
 * Capability now arrives through `phase`, resolved in the mount effect.
 */
function ModelStatus({
  phase,
  status,
  skipped,
  loaded,
}: {
  phase: LoadPhase;
  status: string;
  skipped: SkipReason | null;
  loaded: string | null;
}) {
  if (phase === "idle") return null;

  const readyLabel = BROWSER_MODELS.find((model) => model.id === loaded)?.label;
  const text =
    phase === "ready"
      ? `[local model] ready${readyLabel ? ` / ${readyLabel}` : ""}`
      : phase === "loading"
        ? `[local model] ${status || "loading ..."}`
        : skipped
          ? `[server model] ${SKIP_LABEL[skipped]}`
          : `[server model] ${status || "local model unavailable"}`;

  return (
    <p aria-live="polite" className="jr-status">
      {text}
    </p>
  );
}
