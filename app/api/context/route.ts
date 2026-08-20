import { NextResponse } from "next/server";
import { retrievePortfolio } from "@/lib/retrieve";
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
  const body = (await request.json()) as { query?: string };
  const query = body.query?.trim();

  if (!query) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const capsules = retrievePortfolio(query);
  return NextResponse.json({ capsules, repos: await readReposFor(query, capsules) });
}
