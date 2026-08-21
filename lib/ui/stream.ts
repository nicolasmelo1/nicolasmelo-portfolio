/**
 * Pulling whole operations out of a partially-arrived JSON transaction.
 *
 * The model streams one object — `{"label": "...", "ops": [ ... ]}` — a few
 * characters at a time, and half of it is not applicable. But the ops inside are
 * independent and ordered, and each one carries an inverse, so a *complete* op
 * is applicable the moment it closes even if the transaction is not finished.
 * This scanner finds those boundaries.
 *
 * It is deliberately a brace-depth scanner rather than a JSON parser: there is
 * no valid document to parse until the last byte arrives, and the point is to
 * act before then.
 */
export type ScanResult = {
  /** Ops that closed in this chunk, in order. */
  ops: unknown[];
  /** The label, once it has arrived. Emitted once. */
  label: string | null;
};

/**
 * Pull the transaction object out of a reply that has prose around it.
 *
 * Models preamble. `openrouter/free` routes to reasoning models that answer
 * "Let me analyse the request..." and then the JSON, and stripping code fences
 * did nothing for that — the parse threw and every such answer silently became
 * the deterministic fallback after a 55-second wait.
 *
 * Scans for the first `{` and its matching `}`, string- and escape-aware, so
 * braces inside string values do not end the object early.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unbalanced: the reply was cut off.
  return null;
}

export function createOpScanner() {
  let buffer = "";
  let cursor = 0;
  /** Set once `"ops"` has been seen and its `[` consumed. */
  let inArray = false;
  let label: string | null = null;
  let labelEmitted = false;

  /** Depth and string state for the object currently being read. */
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  function readLabel() {
    if (label !== null) return;
    // `"label"` then optional space, then a JSON string. Only matched once the
    // closing quote has arrived, so a half-written label is never emitted.
    const match = /"label"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(buffer);
    if (!match) return;
    try {
      label = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      label = null;
    }
  }

  function enterArray() {
    if (inArray) return;
    const key = buffer.indexOf('"ops"', cursor);
    if (key === -1) return;
    const bracket = buffer.indexOf("[", key);
    if (bracket === -1) return;
    cursor = bracket + 1;
    inArray = true;
  }

  /**
   * Advance through one character of the object in progress. Returns the
   * object's text when its final brace arrives.
   */
  function stepInsideObject(char: string): string | null {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      return null;
    }

    if (char === '"') {
      inString = true;
      return null;
    }
    if (char === "{") {
      depth += 1;
      return null;
    }
    if (char !== "}") return null;

    depth -= 1;
    if (depth > 0) return null;

    const text = buffer.slice(start, cursor + 1);
    start = -1;
    return text;
  }

  /** Between objects: pick up the next `{`, or notice the `]` that ends the array. */
  function stepBetweenObjects(char: string): "closed" | null {
    if (char === "{") {
      start = cursor;
      depth = 1;
      inString = false;
      escaped = false;
      return null;
    }
    if (char === "]") {
      inArray = false;
      return "closed";
    }
    return null;
  }

  function scanObjects(ops: unknown[]) {
    while (cursor < buffer.length) {
      const char = buffer[cursor];

      if (start === -1) {
        const outcome = stepBetweenObjects(char);
        cursor += 1;
        if (outcome === "closed") return;
        continue;
      }

      const text = stepInsideObject(char);
      cursor += 1;
      if (text === null) continue;

      try {
        ops.push(JSON.parse(text));
      } catch {
        // A brace-balanced fragment that is not valid JSON. Nothing useful to
        // do with it, and the final gate still runs.
      }
    }
  }

  return {
    /** Feed the next piece of the response. Returns whatever it completed. */
    push(chunk: string): ScanResult {
      buffer += chunk;
      const ops: unknown[] = [];

      readLabel();
      enterArray();
      if (inArray) scanObjects(ops);

      const emit = !labelEmitted && label !== null ? label : null;
      if (emit !== null) labelEmitted = true;
      return { ops, label: emit };
    },
  };
}
