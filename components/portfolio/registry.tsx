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
 * How the vocabulary looks.
 *
 * The design system is `+ - | . > < [ ] / _` and monospace. No radii, no
 * shadows, no gradients, no icon glyphs — a rule is a row of dashes, a
 * disclosure is `>` or `v`, a button is `[ label ]`. Everything is still a real
 * component underneath: the accordion collapses, the tabs switch, the carousel
 * pages. Only the surface is text.
 */

const LAYOUT = {
  stack: "flex flex-col gap-4",
  columns: "flex flex-row gap-4 [&>*]:flex-1 [&>*]:min-w-0",
  grid: "grid grid-cols-1 gap-4 md:grid-cols-2",
} as const;

const ALIGN = {
  start: "justify-start",
  center: "justify-center",
  between: "justify-between",
} as const;

/** `+[ LABEL ]-----------+`, or `+-----+` with no label. */
function rule(label?: string | null) {
  const head = label ? `+[ ${label} ]` : "+";
  return `${head}${"-".repeat(Math.max(3, 72 - head.length))}+`;
}

function Rule({ label }: { label?: string | null }) {
  return (
    <pre aria-hidden="true" className="jr-rule">
      {rule(label)}
    </pre>
  );
}

/** `>` closed, `v` open. */
function Caret({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className="jr-caret">
      {open ? "v" : ">"}
    </span>
  );
}

function Clip({ children }: { children: ReactNode }) {
  return <div className="jr-clip">{children}</div>;
}

/* ---------------------------------------------------------------- Tabs ----- */

type TabsRegistry = {
  active: string | null;
  activate: (id: string) => void;
  register: (id: string, label: string) => void;
  unregister: (id: string) => void;
};

const TabsContext = createContext<TabsRegistry | null>(null);

function TabsRoot({ children }: { children?: ReactNode }) {
  const [panels, setPanels] = useState<Array<{ id: string; label: string }>>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  const register = useCallback((id: string, label: string) => {
    setPanels((current) => (current.some((p) => p.id === id) ? current : [...current, { id, label }]));
  }, []);

  const unregister = useCallback((id: string) => {
    setPanels((current) => current.filter((p) => p.id !== id));
  }, []);

  // First to register is the default; if a Δ removes the chosen panel the
  // selection falls back rather than blanking the region.
  const active = chosen && panels.some((p) => p.id === chosen) ? chosen : panels[0]?.id ?? null;

  const value = useMemo<TabsRegistry>(
    () => ({ active, activate: setChosen, register, unregister }),
    [active, register, unregister],
  );

  return (
    <TabsContext.Provider value={value}>
      <div className="jr-tabs">
        {panels.length > 1 ? (
          <div role="tablist" className="jr-tablist">
            {panels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={panel.id === active}
                onClick={() => setChosen(panel.id)}
                className="jr-tab"
              >
                {panel.id === active ? `[*${panel.label}*]` : `[ ${panel.label} ]`}
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

  if (!tabs) return <Clip>{children}</Clip>;
  if (tabs.active !== id) return null;
  return (
    <div role="tabpanel" className="jr-clip">
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
    <div className="jr-carousel">
      <div className="jr-carousel-bar">
        <span className="jr-truncate">{props.label ?? ""}</span>
        <span className="jr-pager">
          <button
            type="button"
            aria-label="previous"
            disabled={index === 0}
            onClick={() => setAt(index - 1)}
            className="jr-step"
          >
            [ &lt; ]
          </button>
          <span>
            {slides.length ? index + 1 : 0}/{slides.length}
          </span>
          <button
            type="button"
            aria-label="next"
            disabled={index >= slides.length - 1}
            onClick={() => setAt(index + 1)}
            className="jr-step"
          >
            [ &gt; ]
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
      <div className={`jr-canvas ${LAYOUT[props.layout]}`}>{children}</div>
    ),

    Row: ({ props, children }) => <div className={`jr-row ${ALIGN[props.align]}`}>{children}</div>,

    Panel: ({ props, children }) => (
      <section className="jr-panel jr-enter">
        <Rule label={props.note ? `${props.note} :: ${props.title}` : props.title} />
        <h2 className="sr-only">{props.title}</h2>
        <div className="jr-panel-body">{children}</div>
      </section>
    ),

    Card: ({ props, children }) => (
      <article className="jr-card jr-enter">
        <h3 className="jr-card-title">+ {props.title}</h3>
        <p className="jr-text">{props.summary}</p>
        {props.tags.length ? <p className="jr-tags">tags: {props.tags.join(" / ")}</p> : null}
        {children}
      </article>
    ),

    Accordion: ({ children }) => <div className="jr-accordion jr-enter">{children}</div>,

    AccordionItem: ({ props, children }) => {
      const [open, setOpen] = useState(props.open);
      return (
        <div className="jr-item">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="jr-disclose"
          >
            <Caret open={open} />
            <span className="jr-truncate">{props.title}</span>
          </button>
          {open ? <div className="jr-nested">{children}</div> : null}
        </div>
      );
    },

    Tabs: ({ children }) => <TabsRoot>{children}</TabsRoot>,
    TabPanel,
    Carousel: CarouselRoot,

    Collapsible: ({ props, children }) => {
      const [open, setOpen] = useState(props.open);
      return (
        <div className="jr-item">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="jr-disclose jr-dim"
          >
            <Caret open={open} />
            <span>{props.summary}</span>
          </button>
          {open ? <div className="jr-nested">{children}</div> : null}
        </div>
      );
    },

    Alert: ({ props }) => (
      <div role="note" className={`jr-alert jr-enter ${props.tone === "warn" ? "jr-warn" : ""}`}>
        <p className="jr-alert-title">
          {props.tone === "warn" ? "!! " : ".. "}
          {props.title}
        </p>
        {props.body ? <p className="jr-text">{props.body}</p> : null}
      </div>
    ),

    Badge: ({ props }) => <span className="jr-badge">[{props.label}]</span>,

    Stat: ({ props }) => (
      <span className="jr-stat">
        {props.label}: <b>{props.value}</b>
      </span>
    ),

    Text: ({ props }) => <p className="jr-text">{props.text}</p>,

    List: ({ props }) => (
      <ul className={`jr-list ${props.dense ? "jr-dense" : ""}`}>
        {props.items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <span aria-hidden="true" className="jr-bullet">
              |--
            </span>
            <span className="jr-min">{item}</span>
          </li>
        ))}
      </ul>
    ),

    Link: ({ props }) => (
      <p className="jr-link-line">
        <span aria-hidden="true" className="jr-bullet">
          +--&gt;
        </span>{" "}
        <a href={props.href} target="_blank" rel="noreferrer" className="jr-link">
          {props.label}
        </a>
      </p>
    ),

    Breadcrumb: ({ props }) => (
      <nav className="jr-crumbs">
        {props.items.map((item, index) => (
          <span key={`${item}-${index}`}>
            {index > 0 ? " / " : ""}
            {item}
          </span>
        ))}
      </nav>
    ),
  },
});
