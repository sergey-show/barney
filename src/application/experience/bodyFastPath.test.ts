import { expect, test } from "bun:test";
import { admitNewSkill } from "../context/bodyStability.ts";
import {
  fastPathFallthrough,
  selectBodyFastPath,
} from "./bodyFastPath.ts";

test("selectBodyFastPath picks frozen procedure overlapping the query", () => {
  const frozen = {
    ...admitNewSkill("house-redact-tokens", "sanitize", "secret-leak"),
    status: "frozen" as const,
    wins: 3,
    procedure: [
      "replace live secrets with house tokens",
      "write audit.txt counts",
    ],
  };
  const hit = selectBodyFastPath({
    skills: [frozen],
    query: "sanitize secrets with house redaction tokens and audit",
  });
  expect(hit?.skill).toBe("house-redact-tokens");
  expect(hit?.prompt).toContain("BODY FAST-PATH");
});

test("quarantine without verified status is ignored", () => {
  const q = {
    ...admitNewSkill("temp", "sanitize", "secret-leak"),
    procedure: ["replace secrets"],
  };
  expect(selectBodyFastPath({ skills: [q], query: "sanitize secrets" })).toBeNull();
});

test("fastPathFallthrough fires when attempted skill fails", () => {
  const r = fastPathFallthrough({
    attemptedSkill: "house-redact-tokens",
    outcomeOk: false,
    falseSkills: ["house-redact-tokens"],
  });
  expect(r.fallthrough).toBe(true);
  expect(r.line).toContain("fallthrough: 1");
});
