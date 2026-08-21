/**
 * Reading the repositories on demand.
 *
 * The capsules in `content/portfolio.ts` say what a project is *for*. They
 * cannot say what is in it — which languages, how it is laid out, what the
 * README covers — and that is exactly what someone asking a second question
 * wants. Rather than copying those facts into the content file, where they go
 * stale the moment a commit lands, they are read from GitHub when the question
 * calls for them.
 *
 * Everything here degrades: a failed or rate-limited call yields less context,
 * never an error. The unauthenticated API allows 60 requests an hour per
 * address and one insight costs four, so the cache is not an optimisation.
 */

export type RepoInsight = {
  slug: string;
  description: string | null;
  primaryLanguage: string | null;
  /** Top languages by bytes, as whole percentages. */
  languages: Array<{ name: string; share: number }>;
  topics: string[];
  stars: number;
  license: string | null;
  createdAt: string | null;
  lastPush: string | null;
  /** Top-level entries, directories first. */
  structure: string[];
  /** Headings from the README, in order — the author's own outline. */
  readmeSections: string[];
};

export type RepoResponse = {
  description?: string | null;
  language?: string | null;
  topics?: string[];
  stargazers_count?: number;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  created_at?: string | null;
  pushed_at?: string | null;
};

export type ContentEntry = { name?: string; type?: string };

const API = "https://api.github.com";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * A rate-limited miss is temporary, so it is cached for minutes rather than
 * hours — long enough to stop hammering a spent budget, short enough that the
 * next window recovers on its own.
 */
const RATE_LIMITED_TTL_MS = 15 * 60 * 1000;
const MAX_LANGUAGES = 5;
const MAX_STRUCTURE = 12;
const MAX_SECTIONS = 10;

const cache = new Map<string, { at: number; ttl: number; insight: RepoInsight | null }>();

/** True once GitHub has refused for quota reasons during this fetch. */
let rateLimited = false;

/**
 * Authenticate when a token is available.
 *
 * Unauthenticated GitHub allows 60 requests an hour per address, and on a
 * deployed site every visitor shares the server's address — so one insight per
 * four requests means roughly fifteen reads an hour for everyone combined. A
 * token raises that to 5,000. It is optional on purpose: the feature degrades
 * without it rather than requiring configuration to run at all.
 */
function headers(accept: string) {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: accept,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** The `owner/repo` part of a GitHub URL, or null if it is not one. */
export function repoSlug(href: string): string | null {
  const match = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/.exec(href);
  if (!match) return null;
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

function day(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

export function summarizeLanguages(bytes: Record<string, number>): RepoInsight["languages"] {
  const total = Object.values(bytes).reduce((sum, n) => sum + n, 0);
  if (!total) return [];
  return Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LANGUAGES)
    .map(([name, n]) => ({ name, share: Math.max(1, Math.round((n / total) * 100)) }));
}

export function summarizeStructure(entries: ContentEntry[]): string[] {
  const dirs = entries.filter((e) => e.type === "dir" && e.name);
  const files = entries.filter((e) => e.type === "file" && e.name);
  return [
    ...dirs.map((e) => `${e.name}/`),
    ...files.map((e) => e.name as string),
  ].slice(0, MAX_STRUCTURE);
}

/**
 * Markdown headings, in document order.
 *
 * Fenced blocks are stripped first: a `#` inside a shell example is a comment,
 * not a section, and including those produced nonsense outlines.
 */
export function summarizeReadme(markdown: string): string[] {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, "");
  const headings: string[] = [];
  for (const line of withoutFences.split("\n")) {
    const match = /^#{1,3}\s+(.+?)\s*#*$/.exec(line.trim());
    if (!match) continue;
    const text = match[1].replace(/[*_`]/g, "").trim();
    if (text && !headings.includes(text)) headings.push(text);
  }
  return headings.slice(0, MAX_SECTIONS);
}

/** 403 and 429 mean the budget is spent, not that the repository is missing. */
function noteRefusal(status: number) {
  if (status === 403 || status === 429) rateLimited = true;
}

async function json<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API}${path}`, { headers: headers("application/vnd.github+json") });
    if (!response.ok) {
      noteRefusal(response.status);
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function readme(slug: string): Promise<string | null> {
  try {
    const response = await fetch(`${API}/repos/${slug}/readme`, {
      headers: headers("application/vnd.github.raw"),
    });
    if (!response.ok) {
      noteRefusal(response.status);
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Assemble one insight from the four raw responses. Pure, so the shape can be
 * tested without a network call — which is most of what can go wrong here.
 */
export function toInsight(
  slug: string,
  repo: RepoResponse | null,
  languages: Record<string, number> | null,
  contents: ContentEntry[] | null,
  readmeText: string | null,
): RepoInsight | null {
  if (!repo) return null;
  return {
    slug,
    description: repo.description ?? null,
    primaryLanguage: repo.language ?? null,
    languages: summarizeLanguages(languages ?? {}),
    topics: (repo.topics ?? []).slice(0, 8),
    stars: repo.stargazers_count ?? 0,
    license: repo.license?.spdx_id ?? repo.license?.name ?? null,
    createdAt: day(repo.created_at),
    lastPush: day(repo.pushed_at),
    structure: summarizeStructure(Array.isArray(contents) ? contents : []),
    readmeSections: readmeText ? summarizeReadme(readmeText) : [],
  };
}

/** Read one repository. Returns null when GitHub says nothing useful. */
export async function fetchRepoInsight(slug: string): Promise<RepoInsight | null> {
  const cached = cache.get(slug);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.insight;

  rateLimited = false;
  const [repo, languages, contents, readmeText] = await Promise.all([
    json<RepoResponse>(`/repos/${slug}`),
    json<Record<string, number>>(`/repos/${slug}/languages`),
    json<ContentEntry[]>(`/repos/${slug}/contents`),
    readme(slug),
  ]);

  // Caching the miss too: without the repository there is nothing to show, and
  // a rate-limited window should not be hammered on every keystroke.
  const insight = toInsight(slug, repo, languages, contents, readmeText);
  cache.set(slug, {
    at: Date.now(),
    ttl: insight === null && rateLimited ? RATE_LIMITED_TTL_MS : CACHE_TTL_MS,
    insight,
  });
  return insight;
}

// `work` is absent too: it belongs to employment questions ("where do you
// work"), and "how does it work" already matches on `how`.
// `built` and `build` are deliberately absent: "what have you built" is the
// broadest question there is, it is answered by the capsules alone, and reading
// two repositories for it costs eight API calls and overflows the viewport.
// They are project-intent words, not depth words.
// `dates`, `commits`, `activity` and `pushed` are here because of a follow-up
// that had no answer: "show me the commit dates" asked for the one fact only
// the repository carries — `lastPush` — named no project, matched nothing in
// this pattern, and so read nothing and rendered nothing. The question is
// answerable; it was the read that never happened.
const DEPTH =
  /\b(how|why|deep|deeper|detail|details|structure|architecture|inside|stack|lang|language|languages|code|implement|readme|repo|repository|explain|tell me more|more about|dates?|commits?|activity|pushed)\b/;

/**
 * Which repositories a question justifies reading, at most two.
 *
 * Reading is not free — four calls against a 60-per-hour budget — so it happens
 * when the question is actually about a project: either it names one, or it asks
 * the kind of thing only the repository can answer. A bare "what have you built"
 * gets the capsules and no fetch.
 */
export function reposToRead(
  query: string,
  capsules: Array<{ id: string; kind: string; aliases: string[]; links?: Array<{ href: string }> }>,
): Array<{ capsuleId: string; slug: string }> {
  const normalized = query.toLowerCase();
  const wantsDepth = DEPTH.test(normalized);
  const picks: Array<{ capsuleId: string; slug: string }> = [];

  for (const capsule of capsules) {
    if (capsule.kind !== "project") continue;
    const named = capsule.aliases.some(
      (alias) => alias.length > 3 && normalized.includes(alias.toLowerCase()),
    );
    if (!named && !wantsDepth) continue;

    const slug = (capsule.links ?? []).map((link) => repoSlug(link.href)).find(Boolean);
    if (slug) picks.push({ capsuleId: capsule.id, slug });
    if (picks.length === 2) break;
  }

  return picks;
}

/** Read every repository a question justifies, tolerating individual failures. */
export async function readReposFor(
  query: string,
  capsules: Array<{ id: string; kind: string; aliases: string[]; links?: Array<{ href: string }> }>,
): Promise<Record<string, RepoInsight>> {
  const picks = reposToRead(query, capsules);
  if (!picks.length) return {};

  const results = await Promise.all(
    picks.map(async (pick) => [pick.capsuleId, await fetchRepoInsight(pick.slug)] as const),
  );

  const insights: Record<string, RepoInsight> = {};
  for (const [capsuleId, insight] of results) {
    if (insight) insights[capsuleId] = insight;
  }
  return insights;
}

/** Only for tests: the cache is process-wide and would leak between them. */
export function clearRepoCache() {
  cache.clear();
}
