"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "@/components/portfolio/registry";
import {
  generateDeltaInBrowser,
  localModelStarted,
  activeModel,
  autoLoadSkipReason,
  startLocalModel,
  type LoadPhase,
  type SkipReason,
} from "@/lib/llm/browser";
import { retrievePortfolio } from "@/lib/retrieve";
import {
  back,
  canGoBack,
  canGoForward,
  commit,
  createTimeline,
  forward,
  head,
  reset,
  type Delta,
  type Source,
  type Timeline,
} from "@/lib/runtime/timeline";
import { BROWSER_MODELS, DEFAULT_MODEL } from "@/lib/llm/models";
import { withViewTransition } from "@/lib/ui/animate";
import { deterministicDelta } from "@/lib/ui/delta";
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
    try {
      timeline = commit(timeline, delta);
    } catch {
      // A Δ authored against an older catalog is simply not replayed. The
      // journal is a record of intent, not a migration.
      break;
    }
  }
  const target = Math.min(stored.cursor, timeline.entries.length);
  while (timeline.cursor > target) timeline = back(timeline);
  return timeline;
}

export function PortfolioApp() {
  const [timeline, setTimeline] = useState<Timeline>(() => createTimeline(initialSpec));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Source>("deterministic");
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [status, setStatus] = useState("");
  const [skipped, setSkipped] = useState<SkipReason | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // localStorage, `navigator.gpu` and the connection type do not exist during
    // SSR, so all of this has to run after mount. Reading them in a state
    // initialiser would render a different tree on the server than on the
    // client and break hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only reads, see above
    setHydrated(true);

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setTimeline(restore(JSON.parse(saved) as Stored));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    // The model loads itself, in a worker, without being asked and without
    // blocking anything. Until it is ready every question goes to the server
    // route, so the only thing a visitor notices is that answers get faster.
    // `idle` means "the browser has not told us anything yet", which is also
    // what the server renders. Resolving it here rather than in render is what
    // keeps the first client paint identical to the server HTML.
    const skip = autoLoadSkipReason();
    if (skip || localModelStarted()) {
      setPhase("unavailable");
      setSkipped(skip);
      return;
    }
    setPhase("loading");
    startLocalModel((message) => setStatus(message))
      .then(() => {
        setPhase("ready");
        setStatus("");
        // Which model came up matters: a failed default falls back silently
        // otherwise, and "ready" would hide that it is not the one we chose.
        setLoaded(activeModel());
      })
      .catch((error: unknown) => {
        setPhase("unavailable");
        setStatus(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const stored: Stored = {
      deltas: timeline.entries.map((entry) => entry.delta),
      cursor: timeline.cursor,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [hydrated, timeline]);

  async function ask(raw: string) {
      const question = raw.trim();
      if (!question || busy) return;

      setBusy(true);
      setQuery("");
      const spec = timeline.current;

      const applyDelta = (proposal: { label: string; ops: Delta["ops"] }, from: Source) => {
        withViewTransition(() => {
          setTimeline((current) =>
            commit(current, {
              id: `d${current.entries.length + 1}`,
              query: question,
              source: from,
              ...proposal,
            }),
          );
          setSource(from);
        });
      };

      // The local attempt gets its own guard. It used to sit inside the same
      // try as the server call, so a thrown engine error jumped straight to the
      // last-resort branch below — skipping the server, and with it the cloud
      // author and the repository read. A local failure should cost latency,
      // not the whole answer.
      if (phase === "ready") {
        try {
          const local = await generateDeltaInBrowser(question, spec);
          if (local) {
            applyDelta(local, "local");
            setBusy(false);
            inputRef.current?.focus();
            return;
          }
        } catch (error) {
          console.warn("[local model] could not author a Δ, asking the server", error);
        }
      }

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: question, spec }),
        });
        if (!response.ok) throw new Error(`chat endpoint returned ${response.status}`);

        const payload = (await response.json()) as {
          delta?: { label?: string; ops?: Delta["ops"] };
          source?: Source;
        };
        if (!payload.delta?.ops?.length || !payload.delta.label) {
          throw new Error("endpoint returned no transaction");
        }
        applyDelta(
          { label: payload.delta.label, ops: payload.delta.ops },
          payload.source ?? "deterministic",
        );
      } catch {
        // No repo read here: this branch runs because the network just failed,
        // so another fetch would only add latency. Labelled `offline` rather
        // than `deterministic` — the server's deterministic author has the
        // repository data, and this one cannot.
        applyDelta(deterministicDelta(spec, question, retrievePortfolio(question)), "offline");
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(query);
  }

  const empty = timeline.cursor === 0;
  const current = head(timeline);

  const composer = (
    <form onSubmit={submit} className="w-full">
      <div className="flex items-center gap-2 rounded-xl border border-[--line] bg-[--surface-1] px-3 py-2 focus-within:border-[--accent]">
        <span aria-hidden="true" className="font-mono text-xs text-[--fg-faint]">
          ›
        </span>
        <input
          ref={inputRef}
          id="portfolio-query"
          name="query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask about projects, architecture, agents, tooling…"
          autoComplete="off"
          disabled={busy}
          aria-label="Ask"
          className="min-w-0 flex-1 bg-transparent text-sm text-[--fg] outline-none placeholder:text-[--fg-faint] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !query.trim()}
          aria-label="Send"
          className="shrink-0 rounded-lg bg-[--accent] px-2.5 py-1 text-xs font-medium text-[--accent-fg] disabled:opacity-30"
        >
          {busy ? "…" : "↑"}
        </button>
      </div>
    </form>
  );

  const history = (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => withViewTransition(() => setTimeline(back))}
        disabled={!canGoBack(timeline) || busy}
        aria-label="Back to the previous interface"
        className="rounded-md px-2 py-1 text-xs text-[--fg-dim] hover:bg-[--surface-2] hover:text-[--fg] disabled:opacity-25"
      >
        ‹ back
      </button>
      <button
        type="button"
        onClick={() => withViewTransition(() => setTimeline(forward))}
        disabled={!canGoForward(timeline) || busy}
        aria-label="Forward to the next interface"
        className="rounded-md px-2 py-1 text-xs text-[--fg-dim] hover:bg-[--surface-2] hover:text-[--fg] disabled:opacity-25"
      >
        forward ›
      </button>
    </div>
  );

  if (empty) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center overflow-hidden px-6">
        <div className="w-full max-w-2xl">
          <h1 className="mb-6 text-center text-2xl font-medium text-[--fg]">
            What do you want to know?
          </h1>
          {composer}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={busy}
                onClick={() => void ask(preset)}
                className="rounded-full border border-[--line] px-3 py-1.5 text-xs text-[--fg-dim] transition-colors hover:border-[--accent] hover:text-[--fg] disabled:opacity-40"
              >
                {preset}
              </button>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-[--fg-faint]">
            Nicolas Melo — every answer rewrites this page, and every change can be walked back.
          </p>
          {canGoForward(timeline) ? (
            <div className="mt-4 flex justify-center">{history}</div>
          ) : null}
        </div>
        <ModelStatus phase={phase} status={status} skipped={skipped} loaded={loaded} />
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 flex-col gap-2 border-b border-[--line] px-4 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <div className="min-w-0 flex-1">{composer}</div>
          {history}
          <button
            type="button"
            onClick={() => withViewTransition(() => setTimeline(reset))}
            disabled={busy}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-[--fg-faint] hover:text-[--fg] disabled:opacity-25"
          >
            reset
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[--fg-faint]">
          <span className="truncate">
            Δ{timeline.cursor}
            {current ? ` · ${current.label}` : ""}
          </span>
          <span aria-hidden="true">·</span>
          <span>{source}</span>
          {timeline.discarded.length ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{timeline.discarded.flat().length} discarded</span>
            </>
          ) : null}
        </div>
      </header>

      <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-hidden p-4">
        <JSONUIProvider registry={registry}>
          <Renderer spec={timeline.current} registry={registry} />
        </JSONUIProvider>
      </div>

      <ModelStatus phase={phase} status={status} skipped={skipped} loaded={loaded} />
    </main>
  );
}

/**
 * Rendered from props alone. An earlier version asked the browser whether
 * WebGPU existed while rendering, which the server cannot answer the same way —
 * so the server emitted this line and the client did not, and hydration failed.
 * Capability now arrives through `phase`, resolved in the mount effect.
 */
// Derived from the registry so the figure cannot drift from the model in use —
// it already did once, when the copy quoted a VRAM number as a download size.
const SKIP_LABEL: Record<SkipReason, string> = {
  "no-webgpu": "server model · this browser has no WebGPU",
  "data-saver": "server model · data saver is on",
  "slow-connection": `server model · connection too slow for ${DEFAULT_MODEL.downloadMB} MB`,
};

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
  const label =
    phase === "ready"
      ? `local model ready${readyLabel ? ` · ${readyLabel}` : ""}`
      : phase === "loading"
        ? status || "loading local model…"
        : skipped
          ? SKIP_LABEL[skipped]
          : `server model · ${status || "local model unavailable"}`;

  return (
    <p
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 right-4 max-w-[40vw] truncate font-mono text-[10px] text-[--fg-faint]"
    >
      {label}
    </p>
  );
}
