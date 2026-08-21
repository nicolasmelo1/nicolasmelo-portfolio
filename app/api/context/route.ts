import { NextResponse } from "next/server";
import { resolveTurn, sanitizeHistory } from "@/lib/conversation";
import { readReposFor } from "@/lib/sources/github";

/**
 * Context for a question, without generating anything.
 *
 * This exists so the local model does not read GitHub from the visitor's
 * browser. It did, and that was wrong three times over: it spent the visitor's
 * own 60-requests-per-hour budget, it could not share the cache this process
 * already keeps, and every rate-limited call surfaced as a red 403 in their
 * console. Generation is the expensive part and stays on their device; fetching
 * context is cheap and belongs here, once, behind a shared cache.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { query?: string; history?: unknown };
  const query = body.query?.trim();

  if (!query) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // Resolved against the conversation, not the query alone: the browser model
  // gets the same subject the server would have chosen, or it answers a
  // follow-up about whatever the isolated words happened to match.
  const { intent, capsules } = resolveTurn(query, sanitizeHistory(body.history));
  return NextResponse.json({
    intent,
    capsules,
    repos: await readReposFor(query, capsules),
  });
}
