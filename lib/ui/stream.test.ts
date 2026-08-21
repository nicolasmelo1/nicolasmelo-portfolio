import { describe, expect, it } from "vitest";
import { createOpScanner, extractJsonObject } from "@/lib/ui/stream";

describe("extractJsonObject", () => {
  it("returns a plain object unchanged", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("finds the object after a reasoning preamble", () => {
    // The reported failure, verbatim: `openrouter/free` routes to reasoning
    // models that answer in prose first, and stripping code fences did nothing.
    const reply = 'Let me analyse the request.\n\nHere is the transaction:\n{"label":"x","ops":[]}';
    expect(extractJsonObject(reply)).toBe('{"label":"x","ops":[]}');
  });

  it("finds the object inside a code fence, and ignores what follows", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```\nHope that helps!')).toBe('{"a":1}');
  });

  it("is not fooled by braces inside strings", () => {
    const json = '{"text":"a } b { c","n":1}';
    expect(extractJsonObject(`noise ${json} noise`)).toBe(json);
  });

  it("is not fooled by an escaped quote before a brace", () => {
    const json = '{"text":"he said \\"} \\" and left","n":1}';
    expect(extractJsonObject(json)).toBe(json);
  });

  it("keeps nested objects whole", () => {
    const json = '{"ops":[{"node":{"props":{"a":{"b":1}}}}]}';
    expect(extractJsonObject(json)).toBe(json);
  });

  it("returns null when the reply was cut off", () => {
    expect(extractJsonObject('{"label":"x","ops":[{"kind":"reg')).toBeNull();
  });

  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("I cannot help with that.")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });
});

describe("createOpScanner", () => {
  const transaction = JSON.stringify({
    label: "explain logion",
    ops: [
      { kind: "unregister", id: "old" },
      {
        kind: "register",
        id: "panel",
        node: { type: "Panel", props: { title: "Logion", note: null }, children: [] },
      },
      { kind: "attach", parent: "canvas", child: "panel" },
    ],
  });

  /** Feed a whole string in fixed-size pieces. */
  function feed(text: string, size: number) {
    const scanner = createOpScanner();
    const ops: unknown[] = [];
    const labels: string[] = [];
    for (let i = 0; i < text.length; i += size) {
      const result = scanner.push(text.slice(i, i + size));
      ops.push(...result.ops);
      if (result.label !== null) labels.push(result.label);
    }
    return { ops, labels };
  }

  it("emits every op exactly once, in order, one character at a time", () => {
    const { ops } = feed(transaction, 1);
    expect(ops).toHaveLength(3);
    expect(ops.map((op) => (op as { kind: string }).kind)).toEqual([
      "unregister",
      "register",
      "attach",
    ]);
  });

  it("gives the same result at every chunk size", () => {
    // Chunk boundaries land inside strings, inside escapes and between braces.
    const reference = feed(transaction, 1);
    for (const size of [2, 3, 7, 13, 64, transaction.length]) {
      expect(feed(transaction, size), `size ${size}`).toEqual(reference);
    }
  });

  it("emits the label once, and only when it is complete", () => {
    const scanner = createOpScanner();
    expect(scanner.push('{"label":"half').label).toBeNull();
    expect(scanner.push(' written"').label).toBe("half written");
    expect(scanner.push(',"ops":[]}').label).toBeNull();
  });

  it("keeps nested objects and arrays whole", () => {
    const { ops } = feed(transaction, 1);
    const register = ops[1] as { node: { props: { title: string }; children: string[] } };
    expect(register.node.props.title).toBe("Logion");
    expect(register.node.children).toEqual([]);
  });

  it("is not fooled by braces or brackets inside string values", () => {
    const tricky = JSON.stringify({
      label: "x",
      ops: [{ kind: "register", id: "t", node: { type: "Text", props: { text: "a } b ] c [" } } }],
    });
    const { ops } = feed(tricky, 1);
    expect(ops).toHaveLength(1);
    expect((ops[0] as { node: { props: { text: string } } }).node.props.text).toBe("a } b ] c [");
  });

  it("is not fooled by an escaped quote", () => {
    const tricky = JSON.stringify({
      label: "x",
      ops: [{ kind: "register", id: "t", node: { props: { text: 'he said "}" once' } } }],
    });
    const { ops } = feed(tricky, 1);
    expect(ops).toHaveLength(1);
  });

  it("skips a reasoning preamble before the transaction", () => {
    const { ops, labels } = feed(`Let me think about this.\n\n${transaction}`, 5);
    expect(labels).toEqual(["explain logion"]);
    expect(ops).toHaveLength(3);
  });

  it("stops at the end of the ops array and ignores what follows", () => {
    const scanner = createOpScanner();
    scanner.push('{"label":"x","ops":[{"kind":"unregister","id":"a"}]');
    const after = scanner.push(',"extra":[{"kind":"unregister","id":"b"}]}');
    expect(after.ops).toEqual([]);
  });

  it("emits nothing while the first op is still arriving", () => {
    const scanner = createOpScanner();
    expect(scanner.push('{"label":"x","ops":[{"kind":"regi').ops).toEqual([]);
    expect(scanner.push('ster","id":"a","node":{"type":"Text"').ops).toEqual([]);
    expect(scanner.push("}}").ops).toHaveLength(1);
  });

  it("survives a fragment that is brace-balanced but not valid JSON", () => {
    const scanner = createOpScanner();
    // Dropped instead of throwing: the final gate still has to pass.
    expect(scanner.push('{"ops":[{not json},{"kind":"unregister","id":"a"}]}').ops).toHaveLength(1);
  });

  it("emits nothing for a reply with no transaction in it", () => {
    const scanner = createOpScanner();
    const result = scanner.push("I cannot help with that.");
    expect(result.ops).toEqual([]);
    expect(result.label).toBeNull();
  });
});
