import type { Spec } from "@json-render/core";
import type { PortfolioCapsule } from "@/content/portfolio";
import { describeVocabulary } from "@/lib/ui/catalog";
import { ROOT_ID } from "@/lib/ui/spec";

/**
 * The model's whole job is to author one Δ: a list of ops. It never writes
 * markup, styles, code or a whole document, so the worst a bad answer can do is
 * be wrong — and a wrong Δ is one `back` away from never having happened.
 */
export function buildDeltaPrompt(
  query: string,
  currentSpec: Spec,
  context: PortfolioCapsule[],
  repos: Record<string, unknown> = {},
) {
  return {
    system: [
      "You modify a live interface by emitting a transaction of operations. You never write JSX, HTML, CSS, markdown, code fences or commentary.",

      'Reply with exactly one JSON object: {"label": "<=48 chars", "ops": [...]}. The label names the change, like a commit subject.',

      [
        "The operations, and nothing else:",
        '- {"kind":"register","id":"<id>","node":{"type":"<Component>","props":{...},"children":[]}}',
        '- {"kind":"unregister","id":"<id>"}',
        '- {"kind":"attach","parent":"<id>","child":"<id>","index":<optional int>}',
        '- {"kind":"detach","parent":"<id>","child":"<id>"}',
        '- {"kind":"patchProps","id":"<id>","props":{...}}',
        '- {"kind":"dropProps","id":"<id>","keys":["..."]}',
        '- {"kind":"setRoot","id":"<id>"}',
      ].join("\n"),

      [
        "Rules that make a transaction valid:",
        `- The root is \`${ROOT_ID}\`. It always exists, and it can never be unregistered, detached or replaced. Attach your top-level work to it.`,
        "- Register a node before attaching it. Attach every node you register, or it will never be seen.",
        "- Ids must be new and descriptive, kebab-case, prefixed by the topic (e.g. `masa-panel`, `masa-links`).",
        "- Order matters: the ops run in sequence, so a parent must exist before its child is attached.",
      ].join("\n"),

      [
        "THE PAGE NEVER SCROLLS. The viewport is fixed and content that does not fit is simply invisible.",
        "This is the main constraint on your answer. Make it fit by composing containers, not by writing less:",
        "- More than two topics: one Panel holding an Accordion, one AccordionItem per topic, only the first open.",
        "- Alternatives to compare: Tabs with one TabPanel each.",
        "- A long homogeneous list: a Carousel, one child per page.",
        "- Secondary detail: a Collapsible, closed.",
        "- Two topics of equal weight: patchProps the root to {\"layout\":\"columns\"}.",
        "Prefer four short panels behind an accordion over one panel that overflows.",
      ].join("\n"),

      [
        "Replacing versus extending:",
        `- A new question replaces the view: unregister the nodes that are *children* of \`${ROOT_ID}\`, never \`${ROOT_ID}\` itself, then build the answer.`,
        "- A refinement of what is on screen ('make it compact', 'group by tag') edits it instead: patchProps, attach, detach, and unregister only what the refinement removes.",
        "- Never leave a node registered but unattached.",
      ].join("\n"),

      "Never invent employers, dates, metrics, technologies, links or claims. Use only what the payload contains. If it does not answer the question, say so with an Alert.",

      [
        "`repos` is present when the question justified reading the repository itself. It is live data — languages, top-level structure, README headings, stars, last push — keyed by the capsule it belongs to.",
        "When it is there, use it: that is the depth the question asked for, and it is not in the capsule text.",
        "Put the measurable facts in a Row of Stat, and put `structure` and `readmeSections` behind Collapsible so they do not overflow the viewport.",
        "Never mix the two sources up. A capsule says what a project is for; `repos` says what is in it. Do not attribute one to the other, and do not extrapolate from a file name to a claim about the code.",
      ].join("\n"),

      "The complete component vocabulary. Nothing outside this list exists:",
      describeVocabulary(),
    ].join("\n\n"),

    user: JSON.stringify(
      {
        query,
        current_view: currentSpec,
        portfolio_context: context,
        repos,
      },
      null,
      2,
    ),
  };
}
