import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/**
 * The complete UI vocabulary. The model cannot render anything outside it, and
 * cannot write markup, styles or code — it can only name these components.
 *
 * The frame is fixed and the answer area scrolls, so the containers here are no
 * longer the only way content can be reached. They are still how an answer stays
 * readable: an Accordion collapses siblings, Tabs put panels in the same
 * rectangle, a Carousel pages through them. Composition is a preference now
 * rather than a hard limit, which is why the vocabulary is still mostly
 * containers.
 *
 * The rest are shapes for one kind of fact each, and they exist because the
 * answer was worse without them. A comparison of four projects against four
 * employers used to be two lists side by side, leaving the reader to line the
 * rows up by eye; that is a Table. Ten dated roles used to be ten `when:` stats
 * in ten panels; that is a Timeline. A repository's language split used to be
 * one string reading "TypeScript 98% · Python 2%"; that is a Meter.
 */
const COMPONENTS = {
    Canvas: {
      props: z.object({
        layout: z.enum(["stack", "columns", "grid"]).default("stack"),
      }),
      slots: ["default"],
      description:
        "Root region. `columns` splits horizontally, `grid` tiles children, `stack` flows vertically. Prefer columns or grid once there is more than one panel, so the answer reads across rather than only down.",
    },
    Row: {
      props: z.object({ align: z.enum(["start", "center", "between"]).default("start") }),
      slots: ["default"],
      description: "Horizontal group of children. Use for side-by-side panels or a toolbar.",
    },
    Panel: {
      props: z.object({
        title: z.string(),
        note: z.string().nullable().default(null),
      }),
      slots: ["default"],
      description:
        "A titled region with a border. The main structural unit — one Panel per topic the answer covers.",
    },
    Card: {
      props: z.object({
        title: z.string(),
        summary: z.string(),
        tags: z.array(z.string()).default([]),
      }),
      slots: ["default"],
      description:
        "A self-contained item: a project, a role, a link target. Children can add detail below the summary.",
    },
    Accordion: {
      props: z.object({}),
      slots: ["default"],
      description:
        "Vertically stacked collapsible sections. Children must be AccordionItem. The primary tool for fitting many sections into a fixed height.",
    },
    AccordionItem: {
      props: z.object({
        title: z.string(),
        open: z.boolean().default(false),
      }),
      slots: ["default"],
      description: "One section of an Accordion. Open exactly one by default, usually the first.",
    },
    Tabs: {
      props: z.object({}),
      slots: ["default"],
      description:
        "Panels sharing one rectangle, switched by a label row. Children must be TabPanel. Use when sections are alternatives rather than a list.",
    },
    TabPanel: {
      props: z.object({ label: z.string() }),
      slots: ["default"],
      description: "One panel of a Tabs group.",
    },
    Carousel: {
      props: z.object({ label: z.string().nullable().default(null) }),
      slots: ["default"],
      description:
        "Pages through children one at a time with previous/next. Use for a long homogeneous list that would otherwise overflow.",
    },
    Collapsible: {
      props: z.object({
        summary: z.string(),
        open: z.boolean().default(false),
      }),
      slots: ["default"],
      description: "A single disclosure. Use to hide detail that is not needed to answer.",
    },
    Alert: {
      props: z.object({
        tone: z.enum(["info", "warn"]).default("info"),
        title: z.string(),
        body: z.string().nullable().default(null),
      }),
      description: "A short callout. Use sparingly, for a caveat or a limitation.",
    },
    Badge: {
      props: z.object({ label: z.string() }),
      description: "A compact inline label, for a tag or a status.",
    },
    Stat: {
      props: z.object({ label: z.string(), value: z.string() }),
      description: "One labelled figure. Group several inside a Row.",
    },
    Table: {
      props: z.object({
        columns: z.array(z.string()).min(1),
        rows: z.array(z.array(z.string())),
        caption: z.string().nullable().default(null),
      }),
      description:
        "A grid of short cells. The one right answer for comparing things: one column per thing, one row per property. Every row must have exactly as many cells as there are columns. Keep cells to a few words; a table is not a place for prose.",
    },
    Timeline: {
      props: z.object({
        items: z.array(z.object({ when: z.string(), what: z.string() })).min(1),
      }),
      description:
        "Dated entries in the order given, newest first. Use for anything chronological, which is what a work history is. `when` is the date exactly as the context states it, `what` is one short line.",
    },
    Meter: {
      props: z.object({
        label: z.string(),
        percent: z.number().min(0).max(100),
        note: z.string().nullable().default(null),
      }),
      description:
        "One proportion, drawn as a bar. Only for a figure the context actually states as a share, such as a repository's language percentages. Never invent a number to fill one in.",
    },
    Separator: {
      props: z.object({ label: z.string().nullable().default(null) }),
      description:
        "A horizontal divider, optionally labelled. Use to group inside one Panel instead of opening a second one.",
    },
    Text: {
      props: z.object({ text: z.string() }),
      description: "A paragraph of prose. No markdown, no HTML, no emoji, no invented facts.",
    },
    List: {
      props: z.object({
        items: z.array(z.string()),
        dense: z.boolean().default(false),
      }),
      description: "A bulleted list of short strings.",
    },
    Link: {
      props: z.object({ label: z.string(), href: z.string() }),
      description: "An external link. Only ever a URL that appears in the provided context.",
    },
    Breadcrumb: {
      props: z.object({ items: z.array(z.string()) }),
      description: "Shows where the current view sits. Use only when a view is nested.",
    },
};

export const portfolioCatalog = defineCatalog(schema, { components: COMPONENTS, actions: {} });

/**
 * Check every element against the component it claims to be.
 *
 * `portfolioCatalog.validate` accepts an unknown component type but is lenient
 * about props: a `Panel` with `title: 42` passed it. Props come from an
 * untrusted author too, so they are checked here against the same zod schemas
 * the components are declared with.
 */
export function propsMatchComponents(elements: Record<string, { type: string; props?: unknown }>) {
  for (const element of Object.values(elements)) {
    const definition = (COMPONENTS as Record<string, { props: z.ZodType } | undefined>)[element.type];
    if (!definition) return false;
    if (!definition.props.safeParse(element.props ?? {}).success) return false;
  }
  return true;
}

/**
 * The component vocabulary, compactly.
 *
 * `portfolioCatalog.prompt()` is not this. It is json-render's own protocol
 * manual — 17,660 characters instructing the model to emit JSONL RFC 6902 JSON
 * Patch operations — which directly contradicts the transaction format this app
 * asks for. Sending it handed the model two competing specifications and used
 * roughly 4,400 tokens of a 4,096-token window doing it.
 *
 * Derived from the same `COMPONENTS` the catalog is built from, so it cannot
 * describe a component that does not exist, and prop names come from
 * `z.toJSONSchema` rather than being retyped by hand.
 */
export function describeVocabulary() {
  return Object.entries(COMPONENTS)
    .map(([name, definition]) => {
      const props = formatProps(definition.props);
      const slot = "slots" in definition ? " +children" : "";
      return `${name}(${props})${slot} — ${definition.description}`;
    })
    .join("\n");
}

function formatProps(props: z.ZodType) {
  // Named to avoid shadowing the imported `schema`.
  const jsonSchema = z.toJSONSchema(props, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, Record<string, unknown>>;
  };
  const entries = Object.entries(jsonSchema.properties ?? {});
  if (!entries.length) return "";
  return entries.map(([key, value]) => `${key}: ${formatType(value)}`).join(", ");
}

function formatType(value: Record<string, unknown>): string {
  if (Array.isArray(value.enum)) return value.enum.join("|");
  if (Array.isArray(value.anyOf)) {
    return value.anyOf
      .map((entry) => formatType(entry as Record<string, unknown>))
      .filter((name) => name !== "null")
      .join("|");
  }
  if (value.type === "array") {
    return `${formatType((value.items ?? {}) as Record<string, unknown>)}[]`;
  }
  return typeof value.type === "string" ? value.type : "any";
}
