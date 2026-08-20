import { describe, expect, it } from "vitest";
import { buildChatRequest } from "@/lib/llm/browser";

const prompt = { system: "sys", user: "usr" };

describe("buildChatRequest", () => {
  it("passes the prompt through as two messages", () => {
    const request = buildChatRequest(prompt);
    expect(request.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(request.temperature).toBe(0.1);
  });

  // Locking a decision, with the reason, because the obvious "improvement" here
  // is to add grammar-constrained decoding back. In web-llm 0.2.84 the pipeline
  // calls compileJSONSchema(responseFormat.schema) whenever type is
  // "json_object", with no check that a schema was supplied — so the no-schema
  // form throws `Cannot pass non-string to std::string` — and the with-schema
  // form threw the same binding error in a real browser, inside a promise the
  // request never awaits, so it surfaced as an uncaught rejection.
  it("sends no response_format, because web-llm 0.2.84 cannot compile ours", () => {
    expect(buildChatRequest(prompt).response_format).toBeUndefined();
  });

  it("never sends json_object without a schema, which is broken by construction", () => {
    const request = buildChatRequest(prompt);
    if (request.response_format?.type === "json_object") {
      // If someone re-enables the grammar, it must carry a real schema string.
      expect(typeof request.response_format.schema).toBe("string");
      expect(request.response_format.schema!.length).toBeGreaterThan(0);
    }
  });
});
