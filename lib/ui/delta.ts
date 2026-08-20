import type { Spec } from "@json-render/core";
import type { PortfolioCapsule } from "@/content/portfolio";
import type { RepoInsight } from "@/lib/sources/github";
import type { Op } from "@/lib/runtime/ops";
import { deltaSchema } from "@/lib/runtime/timeline";
import { ROOT_ID } from "@/lib/ui/spec";

/**
 * Turning intent into ops.
 *
 * Because the viewport never scrolls, a Δ that answers a new question replaces
 * the view rather than appending to it — and replacing means unregistering what
 * it removed, not merely detaching it. Detaching would leave the old nodes in
 * the element map: invisible, still there, exactly the residue the whole
 * journal exists to avoid. The inverse carries the removed nodes, so replacing
 * is still fully reversible.
 */

/** Ops that remove `ids` and everything below them, children first. */
export function subtreeRemovalOps(spec: Spec, ids: string[]): Op[] {
  const ops: Op[] = [];
  const seen = new Set<string>();

  const walk = (id: string) => {
    if (seen.has(id) || !spec.elements[id]) return;
    seen.add(id);
    for (const child of spec.elements[id].children ?? []) walk(child);
    ops.push({ kind: "unregister", id });
  };

  for (const id of ids) walk(id);
  return ops;
}

/** Ops that empty the canvas. */
export function clearViewOps(spec: Spec): Op[] {
  return subtreeRemovalOps(spec, [...(spec.elements[spec.root]?.children ?? [])]);
}

/**
 * The part of an answer that came from reading the repository rather than from
 * the content file. Kept separate so the two are never confused: everything
 * here is live, and everything in the capsule is authored.
 */
function repoOps(insight: RepoInsight, prefix: string) {
  const ops: Op[] = [];
  const children: string[] = [];

  const facts: Array<[string, string]> = [];
  if (insight.primaryLanguage) facts.push(["language", insight.primaryLanguage]);
  if (insight.languages.length > 1) {
    facts.push(["mix", insight.languages.map((l) => `${l.name} ${l.share}%`).join(" · ")]);
  }
  if (insight.stars) facts.push(["stars", String(insight.stars)]);
  if (insight.lastPush) facts.push(["last push", insight.lastPush]);
  if (insight.license) facts.push(["license", insight.license]);

  if (facts.length) {
    const rowId = `${prefix}-repo-facts`;
    ops.push({
      kind: "register",
      id: rowId,
      node: { type: "Row", props: { align: "start" }, children: [] },
    });
    facts.forEach(([label, value], index) => {
      const id = `${prefix}-fact-${index}`;
      ops.push({
        kind: "register",
        id,
        node: { type: "Stat", props: { label, value }, children: [] },
      });
      ops.push({ kind: "attach", parent: rowId, child: id });
    });
    children.push(rowId);
  }

  const disclosures: Array<[string, string, string[]]> = [
    ["structure", "repository structure", insight.structure],
    ["readme", "what the README covers", insight.readmeSections],
  ];
  for (const [key, summary, items] of disclosures) {
    if (!items.length) continue;
    const wrapId = `${prefix}-${key}`;
    const listId = `${prefix}-${key}-list`;
    ops.push({
      kind: "register",
      id: wrapId,
      node: { type: "Collapsible", props: { summary, open: false }, children: [] },
    });
    ops.push({
      kind: "register",
      id: listId,
      node: { type: "List", props: { items, dense: true }, children: [] },
    });
    ops.push({ kind: "attach", parent: wrapId, child: listId });
    children.push(wrapId);
  }

  return { ops, children };
}

function capsuleBody(
  capsule: PortfolioCapsule,
  prefix: string,
  insight?: RepoInsight,
) {
  const ops: Op[] = [];
  const children: string[] = [];

  // For a role, the dates and the place are the substance, not decoration.
  if (capsule.period || capsule.location) {
    const metaId = `${prefix}-meta`;
    ops.push({
      kind: "register",
      id: metaId,
      node: { type: "Row", props: { align: "start" }, children: [] },
    });
    if (capsule.period) {
      const id = `${prefix}-period`;
      ops.push({
        kind: "register",
        id,
        node: { type: "Stat", props: { label: "when", value: capsule.period }, children: [] },
      });
      ops.push({ kind: "attach", parent: metaId, child: id });
    }
    if (capsule.location) {
      const id = `${prefix}-where`;
      ops.push({
        kind: "register",
        id,
        node: { type: "Stat", props: { label: "where", value: capsule.location }, children: [] },
      });
      ops.push({ kind: "attach", parent: metaId, child: id });
    }
    children.push(metaId);
  }

  const summaryId = `${prefix}-summary`;
  ops.push({
    kind: "register",
    id: summaryId,
    node: { type: "Text", props: { text: capsule.summary }, children: [] },
  });
  children.push(summaryId);

  if (capsule.details?.length) {
    const detailsId = `${prefix}-details`;
    ops.push({
      kind: "register",
      id: detailsId,
      node: { type: "List", props: { items: capsule.details, dense: true }, children: [] },
    });
    children.push(detailsId);
  }

  if (insight) {
    const read = repoOps(insight, prefix);
    ops.push(...read.ops);
    children.push(...read.children);
  }

  if (capsule.links?.length) {
    const rowId = `${prefix}-links`;
    const linkIds = capsule.links.map((_, index) => `${prefix}-link-${index}`);
    ops.push({
      kind: "register",
      id: rowId,
      node: { type: "Row", props: { align: "start" }, children: [] },
    });
    capsule.links.forEach((link, index) => {
      ops.push({
        kind: "register",
        id: linkIds[index],
        node: { type: "Link", props: { label: link.label, href: link.href }, children: [] },
      });
      ops.push({ kind: "attach", parent: rowId, child: linkIds[index] });
    });
    children.push(rowId);
  }

  return { ops, children };
}

/**
 * The fallback author. Used when no model is reachable, and as the shape the
 * prompt shows the model — one Panel for a focused answer, an Accordion once
 * there is more than would fit at once.
 */
export function deterministicDelta(
  spec: Spec,
  query: string,
  capsules: PortfolioCapsule[],
  insights: Record<string, RepoInsight> = {},
): { label: string; ops: Op[] } {
  const ops: Op[] = clearViewOps(spec);
  const stamp = `d${spec.elements[ROOT_ID] ? Object.keys(spec.elements).length : 0}`;
  const collapse = capsules.length > 2;

  if (collapse) {
    const accordionId = `${stamp}-accordion`;
    const panelId = `${stamp}-panel`;
    ops.push({
      kind: "register",
      id: panelId,
      node: {
        type: "Panel",
        props: { title: query.slice(0, 60), note: `${capsules.length} matches` },
        children: [],
      },
    });
    ops.push({
      kind: "register",
      id: accordionId,
      node: { type: "Accordion", props: {}, children: [] },
    });
    ops.push({ kind: "attach", parent: panelId, child: accordionId });

    capsules.forEach((capsule, index) => {
      const itemId = `${stamp}-${capsule.id}`;
      const body = capsuleBody(capsule, itemId, insights[capsule.id]);
      ops.push({
        kind: "register",
        id: itemId,
        node: {
          type: "AccordionItem",
          props: { title: capsule.title, open: index === 0 },
          children: [],
        },
      });
      ops.push(...body.ops);
      for (const child of body.children) {
        ops.push({ kind: "attach", parent: itemId, child });
      }
      ops.push({ kind: "attach", parent: accordionId, child: itemId });
    });

    ops.push({ kind: "attach", parent: ROOT_ID, child: panelId });
    return { label: query.slice(0, 48) || "answer", ops };
  }

  capsules.forEach((capsule) => {
    const panelId = `${stamp}-${capsule.id}`;
    const body = capsuleBody(capsule, panelId, insights[capsule.id]);
    ops.push({
      kind: "register",
      id: panelId,
      node: {
        type: "Panel",
        props: { title: capsule.title, note: capsule.kind.toUpperCase() },
        children: [],
      },
    });
    ops.push(...body.ops);
    for (const child of body.children) {
      ops.push({ kind: "attach", parent: panelId, child });
    }
    ops.push({ kind: "attach", parent: ROOT_ID, child: panelId });
  });

  if (capsules.length > 1) {
    ops.push({ kind: "patchProps", id: ROOT_ID, props: { layout: "columns" } });
  } else {
    ops.push({ kind: "patchProps", id: ROOT_ID, props: { layout: "stack" } });
  }

  return { label: query.slice(0, 48) || "answer", ops };
}

/** Validate a Δ proposal, whoever wrote it. */
export function parseDelta(input: unknown) {
  const result = deltaSchema.safeParse(input);
  return result.success ? result.data : null;
}
