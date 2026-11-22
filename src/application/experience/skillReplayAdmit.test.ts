import { expect, test } from "bun:test";
import { admitNewSkill } from "../context/bodyStability.ts";
import {
  admitSkillCapsule,
  liftBindings,
  qualifyProcedureStructure,
  replayProcedure,
} from "./skillReplayAdmit.ts";

test("liftBindings replaces absolute paths and urls", () => {
  const { procedure, hits } = liftBindings([
    "read /Users/sergey/proj/.env",
    "fetch https://example.com/a",
  ]);
  expect(hits.length).toBeGreaterThan(0);
  expect(procedure[0]).toContain("<binding>");
  expect(procedure[1]).toContain("<binding>");
});

test("replay rejects bindings-only steps", () => {
  expect(replayProcedure(["<binding>"]).ok).toBe(false);
  expect(replayProcedure(["replace live secrets with house tokens"]).ok).toBe(true);
});

test("quarantine stays source-only", () => {
  const rec = admitNewSkill("x", "sanitize", "secret-leak");
  const d = admitSkillCapsule({ ...rec, procedure: ["do a", "do b"] });
  expect(d.admit).toBe(false);
  expect(d.form).toBe("source");
});

test("verified with procedure becomes hybrid after lift", () => {
  const base = admitNewSkill("house-redact", "sanitize", "secret-leak");
  const rec = {
    ...base,
    status: "verified" as const,
    wins: 2,
    procedure: [
      "replace live secrets with <barney-redact-aws>",
      "write audit.txt counts",
    ],
  };
  const d = admitSkillCapsule(rec);
  expect(d.admit).toBe(true);
  expect(d.form).toBe("hybrid");
});

test("verified without procedure is text form", () => {
  const base = admitNewSkill("x", "merge", "merge");
  const d = admitSkillCapsule({ ...base, status: "verified", wins: 2, procedure: undefined });
  expect(d.admit).toBe(true);
  expect(d.form).toBe("text");
  expect(qualifyProcedureStructure(undefined).ok).toBe(false);
});
