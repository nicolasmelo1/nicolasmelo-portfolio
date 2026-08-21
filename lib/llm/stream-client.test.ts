import { describe, expect, it } from "vitest";
import { readDeltaStream, type StreamEvent } from "@/lib/llm/stream-client";

/** A Response whose body arrives in the given pieces. */
function streaming(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

async function collect(...chunks: string[]) {
  const events: StreamEvent[] = [];
  await readDeltaStream(streaming(...chunks), (event) => events.push(event));
  return events;
}

const op = { kind: "unregister", id: "a" };

describe("readDeltaStream", () => {
  it("reads one event per line", async () => {
    const events = await collect(
      `${JSON.stringify({ type: "label", label: "x" })}\n`,
      `${JSON.stringify({ type: "op", op })}\n`,
      `${JSON.stringify({ type: "done" })}\n`,
    );
    expect(events.map((e) => e.type)).toEqual(["label", "op", "done"]);
  });

  it("handles a line split across reads", async () => {
    const line = JSON.stringify({ type: "op", op });
    const events = await collect(line.slice(0, 10), line.slice(10), "\n");
    expect(events).toEqual([{ type: "op", op }]);
  });

  it("handles several events arriving in one read", async () => {
    const events = await collect(
      `${JSON.stringify({ type: "op", op })}\n${JSON.stringify({ type: "op", op })}\n`,
    );
    expect(events).toHaveLength(2);
  });

  it("reads a final line with no trailing newline", async () => {
    // A stream that ends cleanly but without the last newline still said
    // something, and dropping it would lose the `done` that commits the work.
    const events = await collect(JSON.stringify({ type: "done" }));
    expect(events).toEqual([{ type: "done" }]);
  });

  it("skips a malformed line rather than discarding the stream", async () => {
    const events = await collect(
      `${JSON.stringify({ type: "op", op })}\n`,
      "not json at all\n",
      `${JSON.stringify({ type: "done" })}\n`,
    );
    expect(events.map((e) => e.type)).toEqual(["op", "done"]);
  });

  it("skips JSON that is not an event", async () => {
    const events = await collect('{"unexpected":true}\n', '42\n', 'null\n');
    expect(events).toEqual([]);
  });

  it("ignores blank lines", async () => {
    const events = await collect(`\n\n${JSON.stringify({ type: "done" })}\n\n`);
    expect(events).toEqual([{ type: "done" }]);
  });

  it("returns without error on an empty body", async () => {
    await expect(collect("")).resolves.toEqual([]);
    await expect(readDeltaStream(new Response(null), () => {})).resolves.toBeUndefined();
  });
});
