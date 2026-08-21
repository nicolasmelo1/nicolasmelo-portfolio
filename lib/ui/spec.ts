import { validateSpec, type Spec } from "@json-render/core";
import { portfolioCatalog, propsMatchComponents } from "@/lib/ui/catalog";

/**
 * S₀ — the state every path can return to.
 *
 * It is deliberately empty. The first screen is a chat, not a document; the
 * interface only exists once a Δ has built it, and `back` all the way lands
 * here rather than on a hand-written "home" page that would have to be kept in
 * sync with nothing.
 */
export const initialSpec: Spec = {
  root: "canvas",
  elements: {
    canvas: { type: "Canvas", props: { layout: "stack" }, children: [] },
  },
};

export const ROOT_ID = "canvas";

/**
 * Validate a spec against the catalog and the structural rules. Used on
 * anything a model touched, and on anything restored from storage.
 */
export function parsePortfolioSpec(input: unknown) {
  const catalogResult = portfolioCatalog.validate(input);
  if (!catalogResult.success || !catalogResult.data) return null;

  const spec = catalogResult.data as Spec;
  const structuralResult = validateSpec(spec);
  if (!structuralResult.valid) return null;

  // The catalog accepts props it should not, so they are checked against the
  // component declarations as well.
  if (!propsMatchComponents(spec.elements as Record<string, { type: string; props?: unknown }>)) {
    return null;
  }

  return spec;
}
