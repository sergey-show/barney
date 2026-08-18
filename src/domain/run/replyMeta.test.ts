import { expect, test } from "bun:test";
import { formatDuration, formatReplyFootnote, replyMetaFrom } from "./replyMeta.ts";

test("formats a compact footnote", () => {
  expect(formatReplyFootnote({ tokens: 1234, ms: 3400, model: "Qwen3.6-35B-A3B-Hermes-V6" }))
    .toBe("1,234 tok · 3.4 s · Qwen3.6-35B-A3B-Hermes-V6");
});

test("omits missing pieces", () => {
  expect(formatReplyFootnote({ tokens: 0, ms: 842, model: "qwen2.5-7b" })).toBe("842 ms · qwen2.5-7b");
  expect(formatReplyFootnote(undefined)).toBe("");
  expect(replyMetaFrom({})).toBeUndefined();
});

test("formats longer generation time", () => {
  expect(formatDuration(65_000)).toBe("1m 5s");
});
