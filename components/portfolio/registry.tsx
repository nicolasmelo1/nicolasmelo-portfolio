"use client";

import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { defineRegistry } from "@json-render/react";
import { portfolioCatalog } from "@/lib/ui/catalog";

/**
 * How the vocabulary looks. Every component here is a real web component —
 * bordered, spaced, focusable — rather than text art, and every container
 * clamps its own height so the page as a whole never grows a scrollbar.
 */

const LAYOUT = {
  stack: "flex flex-col gap-3",
  columns: "flex flex-row gap-3 [&>*]:flex-1 [&>*]:min-w-0",
  grid: "grid grid-cols-2 gap-3 auto-rows-fr",
} as const;

const ALIGN = {
  start: "justify-start",
  center: "justify-center",
  between: "justify-between",
} as const;

/** Shared shell for anything that clips its own overflow. */
function Clip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 min-w-0 overflow-hidden ${className}`}>{children}</div>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      ›
    </span>
  );
}

/* ---------------------------------------------------------------- Tabs ----- */

type TabsRegistry = {
  active: string | null;
  activate: (id: string) => void;
  register: (id: string, label: string) => void;
  unregister: (id: string) => void;
};

const TabsContext = createContext<TabsRegistry | null>(null);

function TabsRoot({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Array<{ id: string; label: string }>>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  const register = useCallback((id: string, label: string) => {
    setPanels((current) =>
      current.some((p) => p.id === id) ? current : [...current, { id, label }],
    );
  }, []);

  const unregister = useCallback((id: string) => {
    setPanels((current) => current.filter((p) => p.id !== id));
  }, []);

  // The first panel to register is the default, and if the chosen panel is
  // removed by a Δ the selection falls back rather than blanking the region.
  const active = chosen && panels.some((p) => p.id === chosen) ? chosen : panels[0]?.id ?? null;

  const value = useMemo<TabsRegistry>(
    () => ({ active, activate: setChosen, register, unregister }),
    [active, register, unregister],
  );

  return (
    <TabsContext.Provider value={value}>
      <div className="flex min-h-0 flex-col gap-2">
        {panels.length > 1 ? (
          <div role="tablist" className="flex shrink-0 flex-wrap gap-1">
            {panels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={panel.id === active}
                onClick={() => setChosen(panel.id)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  panel.id === active
                    ? "bg-[--surface-3] text-[--fg]"
                    : "text-[--fg-dim] hover:bg-[--surface-2] hover:text-[--fg]"
                }`}
              >
                {panel.label}
              </button>
            ))}
          </div>
        ) : null}
        <Clip>{children}</Clip>
      </div>
    </TabsContext.Provider>
  );
}

function TabPanel({ props, children }: { props: { label: string }; children?: ReactNode }) {
  const id = useId();
  const tabs = useContext(TabsContext);
  const register = tabs?.register;
  const unregister = tabs?.unregister;

  useEffect(() => {
    if (!register || !unregister) return;
    register(id, props.label);
    return () => unregister(id);
  }, [id, props.label, register, unregister]);

  // Without a Tabs parent a panel is still legible on its own.
  if (!tabs) return <Clip>{children}</Clip>;
  if (tabs.active !== id) return null;
  return (
    <div role="tabpanel" className="min-h-0 overflow-hidden">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ Carousel ----- */

function CarouselRoot({
  props,
  children,
}: {
  props: { label: string | null };
  children?: ReactNode;
}) {
  const slides = Children.toArray(children);
  const [at, setAt] = useState(0);
  const index = slides.length ? Math.min(at, slides.length - 1) : 0;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 text-xs text-[--fg-dim]">
        <span className="truncate">{props.label ?? ""}</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label="previous"
            disabled={index === 0}
            onClick={() => setAt(index - 1)}
            className="rounded px-2 py-0.5 hover:bg-[--surface-2] disabled:opacity-30"
          >
            ‹
          </button>
          <span className="tabular-nums">
            {slides.length ? index + 1 : 0}/{slides.length}
          </span>
          <button
            type="button"
            aria-label="next"
            disabled={index >= slides.length - 1}
            onClick={() => setAt(index + 1)}
            className="rounded px-2 py-0.5 hover:bg-[--surface-2] disabled:opacity-30"
          >
            ›
          </button>
        </span>
      </div>
      <Clip>{slides[index] ?? null}</Clip>
    </div>
  );
}

/* ------------------------------------------------------------- registry --- */

export const { registry } = defineRegistry(portfolioCatalog, {
  components: {
    Canvas: ({ props, children }) => (
      <div className={`h-full min-h-0 overflow-hidden ${LAYOUT[props.layout]}`}>{children}</div>
    ),

    Row: ({ props, children }) => (
      <div className={`flex min-w-0 flex-wrap items-start gap-2 ${ALIGN[props.align]}`}>
        {children}
      </div>
    ),

    Panel: ({ props, children }) => (
      <section className="jr-enter flex min-h-0 flex-col overflow-hidden rounded-lg border border-[--line] bg-[--surface-1]">
        <header className="flex shrink-0 items-baseline justify-between gap-3 border-b border-[--line] px-3 py-2">
          <h2 className="truncate text-sm font-medium text-[--fg]">{props.title}</h2>
          {props.note ? (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[--fg-faint]">
              {props.note}
            </span>
          ) : null}
        </header>
        <div className="min-h-0 overflow-hidden p-3">{children}</div>
      </section>
    ),

    Card: ({ props, children }) => (
      <article className="jr-enter flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border border-[--line] bg-[--surface-2] p-3">
        <h3 className="text-sm font-medium text-[--fg]">{props.title}</h3>
        <p className="text-[13px] leading-relaxed text-[--fg-dim]">{props.summary}</p>
        {props.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {props.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-[--line] px-1.5 py-0.5 font-mono text-[10px] text-[--fg-faint]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {children}
      </article>
    ),

    Accordion: ({ children }) => (
      <div className="jr-enter flex min-h-0 flex-col divide-y divide-[--line] overflow-hidden">
        {children}
      </div>
    ),

    AccordionItem: ({ props, children }) => {
      const [open, setOpen] = useState(props.open);
      return (
        <div className="min-h-0">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full items-center gap-2 py-2 text-left text-sm text-[--fg] hover:text-[--accent]"
          >
            <Chevron open={open} />
            <span className="truncate">{props.title}</span>
          </button>
          {open ? <div className="min-h-0 overflow-hidden pb-3 pl-4">{children}</div> : null}
        </div>
      );
    },

    Tabs: ({ children }) => <TabsRoot>{children}</TabsRoot>,
    TabPanel,
    Carousel: CarouselRoot,

    Collapsible: ({ props, children }) => {
      const [open, setOpen] = useState(props.open);
      return (
        <div className="min-h-0">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-2 text-xs text-[--fg-dim] hover:text-[--fg]"
          >
            <Chevron open={open} />
            <span>{props.summary}</span>
          </button>
          {open ? <div className="min-h-0 overflow-hidden pt-2 pl-4">{children}</div> : null}
        </div>
      );
    },

    Alert: ({ props }) => (
      <div
        role="note"
        className={`jr-enter rounded-md border px-3 py-2 text-[13px] ${
          props.tone === "warn"
            ? "border-[--warn-line] bg-[--warn-bg] text-[--warn-fg]"
            : "border-[--line] bg-[--surface-2] text-[--fg-dim]"
        }`}
      >
        <p className="font-medium text-[--fg]">{props.title}</p>
        {props.body ? <p className="mt-0.5 leading-relaxed">{props.body}</p> : null}
      </div>
    ),

    Badge: ({ props }) => (
      <span className="rounded border border-[--line] bg-[--surface-2] px-1.5 py-0.5 font-mono text-[10px] text-[--fg-dim]">
        {props.label}
      </span>
    ),

    Stat: ({ props }) => (
      <div className="rounded-md border border-[--line] bg-[--surface-2] px-3 py-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-[--fg-faint]">
          {props.label}
        </div>
        <div className="text-sm text-[--fg]">{props.value}</div>
      </div>
    ),

    Text: ({ props }) => (
      <p className="text-[13px] leading-relaxed text-[--fg-dim]">{props.text}</p>
    ),

    List: ({ props }) => (
      <ul className={`text-[13px] text-[--fg-dim] ${props.dense ? "space-y-0.5" : "space-y-1.5"}`}>
        {props.items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2 leading-relaxed">
            <span aria-hidden="true" className="select-none text-[--fg-faint]">
              —
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    ),

    Link: ({ props }) => (
      <a
        href={props.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[13px] text-[--accent] underline decoration-[--line] underline-offset-2 hover:decoration-[--accent]"
      >
        {props.label}
        <span aria-hidden="true" className="text-[10px]">
          ↗
        </span>
      </a>
    ),

    Breadcrumb: ({ props }) => (
      <nav className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[--fg-faint]">
        {props.items.map((item, index) => (
          <span key={`${item}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            <span>{item}</span>
          </span>
        ))}
      </nav>
    ),
  },
});
