import type { PortfolioCapsule } from "@/content/portfolio";
import { namesSomething, normalize, retrievePortfolio } from "@/lib/retrieve";

/**
 * What a follow-up is about.
 *
 * A question arrives as one string, and until now that string was the whole
 * input: retrieval, the repository read and the replace-or-edit decision were
 * all computed from it alone. That works for the first question and fails for
 * every one after it. "Put them side by side" retrieved an *employer*, because
 * `them` is a content word to a scorer and one capsule happens to contain "save
 * against them at runtime" — the very word that makes the sentence a follow-up
 * was what chose the wrong subject.
 *
 * The fix does not need conversation memory on the server. `retrievePortfolio`
 * is pure, so the prior *questions* are enough to recompute the prior
 * *subjects*. The client already keeps them, one per Δ in the journal.
 */

export type Intent =
  /** A new question. It chooses its own subject and the view is rebuilt. */
  | "replace"
  /** An adjustment to what is on screen. The subject is carried forward. */
  | "refine"
  /** A question that needs the old subject *and* a new one, to set side by side. */
  | "extend";

/** Comparison is the one intent that widens the subject instead of moving it. */
const COMPARISON = /\b(compare|comparison|versus|vs|against|alongside|difference|differences|both)\b/;

/**
 * Words that only mean something relative to what is already on screen.
 *
 * Three groups, and each one earned its place in the failing conversation:
 * pronouns ("put *them* side by side"), presentation verbs that never name a
 * subject ("make it compact", "group by tag"), and depth words that ask for
 * more about whatever is already there ("show me the commit dates").
 */
const RELATIVE =
  /\b(them|they|these|those|it|that|this|the same|above|previous|earlier|instead|again|side by side|next to each other|beside|columns?|compact|smaller|bigger|wider|group|groups?|sort|order|reorder|collapse|expand|swap|dates?|commits?|activity|recent|deeper|detail|details|more)\b/;

/** Ask for columns, in the words people actually use. */
export const COLUMNS = /\b(side by side|next to each other|beside|columns?|two columns)\b/;

/** How many turns of history are read. Older than this cannot be a referent. */
export const HISTORY_LIMIT = 6;

function relativeIntent(normalizedQuery: string): Intent {
  if (COMPARISON.test(normalizedQuery)) return "extend";
  if (RELATIVE.test(normalizedQuery)) return "refine";
  return "replace";
}

/**
 * Which of the three a question is.
 *
 * Naming a subject settles it: "how does logion work" is a new question even
 * though `how` is a depth word, and treating it as a refinement would answer it
 * with whatever happened to be on screen. Comparison is the exception, because
 * "compare logion with reflow" names two subjects and still has to keep both.
 */
export function classify(query: string): Intent {
  const normalized = normalize(query);
  const relative = relativeIntent(normalized);
  if (relative === "extend") return "extend";
  return namesSomething(normalized) ? "replace" : relative;
}

/**
 * The most recent question that chose a subject rather than adjusting one.
 *
 * Refinements chain — "show me your projects", "side by side", "now the commit
 * dates" — and the referent of the third is the first, not the second. Walking
 * back to the last non-refinement is what makes the chain hold instead of
 * decaying one turn at a time.
 */
export function anchor(history: string[]): string | null {
  const recent = history.slice(-HISTORY_LIMIT);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (classify(recent[i]) !== "refine") return recent[i];
  }
  return recent[0] ?? null;
}

function unique(capsules: PortfolioCapsule[]) {
  const byId = new Map(capsules.map((capsule) => [capsule.id, capsule]));
  return [...byId.values()];
}

/**
 * Both subjects, interleaved and capped.
 *
 * A comparison of four projects against four employers is eight capsules, and
 * the viewport that never scrolls does not have room for eight. Halving each
 * side keeps the answer a comparison rather than a list that happens to contain
 * both.
 */
function widen(carried: PortfolioCapsule[], fresh: PortfolioCapsule[], limit: number) {
  const half = Math.max(1, Math.floor(limit / 2));
  return unique([...carried.slice(0, half), ...fresh.slice(0, half)]).slice(0, limit);
}

export type Resolved = {
  intent: Intent;
  capsules: PortfolioCapsule[];
  /**
   * The question the subject came from — the current one, or the anchor it was
   * carried from. This is what the repository read has to run against: "show me
   * the commit dates" names no project, and reading nothing is how that question
   * came back with no dates in it.
   */
  subjectQuery: string;
};

/**
 * Resolve one turn against the conversation it belongs to.
 *
 * The first question has no history and every intent collapses to `replace`,
 * which is exactly the old behaviour — so a single-shot question resolves the
 * way it always did.
 */
export function resolveTurn(query: string, history: string[] = [], limit = 4): Resolved {
  const fresh = retrievePortfolio(query, limit);
  const previous = anchor(history);
  if (!previous) return { intent: "replace", capsules: fresh, subjectQuery: query };

  const intent = classify(query);
  if (intent === "replace") return { intent, capsules: fresh, subjectQuery: query };

  const carried = retrievePortfolio(previous, limit);
  if (intent === "refine") {
    return { intent, capsules: carried, subjectQuery: previous };
  }
  return { intent, capsules: widen(carried, fresh, limit), subjectQuery: `${previous} ${query}` };
}

/** Trim a client-supplied history to something a prompt can carry. */
export function sanitizeHistory(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= 400)
    .slice(-HISTORY_LIMIT);
}
