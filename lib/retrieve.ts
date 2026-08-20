import { portfolioCapsules, type PortfolioCapsule } from "@/content/portfolio";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "about",
  "do",
  "for",
  "how",
  "i",
  "in",
  "is",
  "me",
  "my",
  "of",
  "on",
  "show",
  "tell",
  "the",
  "to",
  "what",
  "with",
  "you",
  "your",
  // Function words that carry no signal but do appear as whole words in the
  // prose below. `through` alone was enough to reorder an answer: it matched
  // "through extensive caching" and pushed the current role down the list.
  "as",
  "at",
  "by",
  "from",
  "into",
  "it",
  "its",
  "more",
  "over",
  "so",
  "than",
  "that",
  "this",
  "through",
  "up",
  "us",
  "was",
  "we",
]);

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#.-]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token));
}

/**
 * Which kind of capsule the question is asking for, or null.
 *
 * Exactly one kind wins. Boosts used to stack, so "tell me about your career"
 * scored the about capsule (its alias `about` plus its own boost) above every
 * employer — and "show me your github repos" landed on the contact capsule,
 * which listed `github` as an alias. Order is the tie-breaker, and it runs from
 * most specific to least: `about` is the catch-all and must be checked last.
 */
function intentKind(normalizedQuery: string): PortfolioCapsule["kind"] | null {
  const patterns: Array<[PortfolioCapsule["kind"], RegExp]> = [
    ["education", /stud(y|ied|ies)|education|degree|universit|college|graduat|school|academic|certific|credential/],
    // `work with` is about tools; `work` on its own is about employers.
    ["skills", /skills?|stack|technolog|language|tools?|work with/],
    ["experience", /experience|job|career|employ|compan|role|work|hired?|resume|cv|senior|professional/],
    ["contact", /contact|reach|email|links?|linkedin/],
    ["project", /projects?|built|build|repos?|github|open.?source|side.?project/],
    ["about", /about|who|background|profile|where.*(live|based)/],
  ];
  for (const [kind, pattern] of patterns) {
    if (pattern.test(normalizedQuery)) return kind;
  }
  return null;
}

/**
 * Whether the query names a specific capsule.
 *
 * Short aliases are excluded: `rl` would match inside "world", and a two-letter
 * coincidence is not someone naming a subject.
 */
function namesSomething(normalizedQuery: string) {
  return portfolioCapsules.some((capsule) =>
    capsule.aliases.some((alias) => {
      const normalized = normalize(alias);
      return normalized.length >= 4 && normalizedQuery.includes(normalized);
    }),
  );
}

function scoreCapsule(
  query: string,
  capsule: PortfolioCapsule,
  intent: PortfolioCapsule["kind"] | null,
) {
  const normalizedQuery = normalize(query);
  const haystack = normalize(
    [
      capsule.title,
      capsule.summary,
      capsule.tags.join(" "),
      capsule.aliases.join(" "),
      capsule.details?.join(" ") ?? "",
    ].join(" "),
  );

  let score = 0;

  for (const alias of capsule.aliases) {
    const normalizedAlias = normalize(alias);
    if (normalizedAlias && normalizedQuery.includes(normalizedAlias)) score += 12;
  }

  // Whole-word membership, not substring. Substring matching scored `through`
  // against `throughout`, which was enough noise to push the current role below
  // two older ones for "walk me through your experience". Fuzzy matches are the
  // aliases' job, where they are declared on purpose.
  const words = new Set(haystack.split(/\s+/));
  for (const token of tokens(query)) {
    if (words.has(token)) score += token.length > 5 ? 4 : 2;
  }

  if (intent && capsule.kind === intent) score += 10;

  return score;
}

export function retrievePortfolio(query: string, limit = 4) {
  const normalizedQuery = normalize(query);

  // A named subject silences the category. "How does logion work?" is about
  // Logion; `work` in it is grammar, not a request for employment history.
  // Without this, that question returned Logion plus three unrelated jobs,
  // because every experience capsule collected the category boost.
  const intent = namesSomething(normalizedQuery) ? null : intentKind(normalizedQuery);

  const scored = portfolioCapsules
    .map((capsule) => ({ capsule, score: scoreCapsule(query, capsule, intent) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  // Relevance cutoff. A single incidental word match is worth 2 points, so
  // without this the remaining slots filled up with whatever happened to share
  // a word with the question — "How does logion work?" answered with Logion and
  // then three unrelated capsules. Half the leader's score keeps genuine ties
  // (every role scores alike for an open experience question) and drops noise.
  const top = scored[0]?.score ?? 0;
  const ranked = scored
    .filter(({ score }) => score * 2 >= top)
    .slice(0, limit)
    .map(({ capsule }) => capsule);

  if (ranked.length) return ranked;

  // A miss introduces him rather than guessing: who he is, what he does now,
  // and one thing he built. Picking by kind keeps this correct as content moves.
  const first = (kind: PortfolioCapsule["kind"]) =>
    portfolioCapsules.find((capsule) => capsule.kind === kind);
  return [first("about"), first("experience"), first("project")].filter(
    (capsule): capsule is PortfolioCapsule => capsule !== undefined,
  );
}
