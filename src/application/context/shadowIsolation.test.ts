import { expect, test } from "bun:test";
import {
  filterNotesForShadowRecall,
  isRecallUnsafeNote,
  sanitizeRecallText,
  scopeShadowLines,
  SHADOW_REDACT,
} from "./shadowIsolation.ts";

test("sanitizeRecallText redacts live keys and DETECTED masks", () => {
  const raw = "AWS_ACCESS_KEY_ID=AKIATRAINEXAMPLE01 and DETECTED_SECRET_AWS_AABBCCDD and ghp_abcdefghijklmnop1234567890";
  const clean = sanitizeRecallText(raw);
  expect(clean).toContain(SHADOW_REDACT);
  expect(clean).not.toContain("AKIATRAIN");
  expect(clean).not.toContain("DETECTED_SECRET_");
  expect(clean).not.toContain("ghp_");
});

test("unsafe notes tagged secret are excluded", () => {
  expect(isRecallUnsafeNote({
    key: "lesson/x",
    text: "prefer house tokens",
    tags: ["secret"],
  })).toBe(true);
  expect(isRecallUnsafeNote({
    text: "use <barney-redact-aws>",
    tags: ["fail", "rule"],
  })).toBe(false);
});

test("filterNotesForShadowRecall drops unsafe and redacts survivors", () => {
  const out = filterNotesForShadowRecall([
    { key: "ok", text: "house canon 2-space", tags: ["rule"] },
    { key: "bad", text: "token ghp_abcdefghijklmnop1234567890", tags: ["fail"] },
  ]);
  expect(out).toHaveLength(1);
  expect(out[0]?.text).toContain("house canon");
});

test("scopeShadowLines prefers query-relevant lines", () => {
  const scoped = scopeShadowLines(
    [
      "unrelated poetry about gardens",
      "redact secrets with house tokens for .env",
      "merge JSON with sorted keys",
    ],
    "sanitize .env house redaction",
    2,
  );
  expect(scoped[0]?.toLowerCase()).toContain("redact");
});
