import { expect, test } from "bun:test";
import { admitNewSkill } from "../context/bodyStability.ts";
import {
  gateRuleRewrite,
  gateSkillRewrite,
  isMasteredRule,
  isMasteredSkill,
} from "./masteredPin.ts";

test("frozen skill is mastered; quarantine is not", () => {
  const frozen = { ...admitNewSkill("x", "a", "b"), status: "frozen" as const };
  expect(isMasteredSkill(frozen)).toBe(true);
  expect(isMasteredSkill(admitNewSkill("y", "a", "b"))).toBe(false);
});

test("gateSkillRewrite refuses demoting or broad rewrite of frozen", () => {
  const incumbent = {
    ...admitNewSkill("house-redact", "sanitize", "secret-leak"),
    status: "frozen" as const,
    procedure: ["replace secrets", "write audit", "verify"],
  };
  const demote = gateSkillRewrite({
    incumbent,
    next: { ...incumbent, status: "quarantine", procedure: ["invent new path"] },
  });
  expect(demote.allow).toBe(false);
  expect(demote.mode).toBe("reject");

  const annotate = gateSkillRewrite({
    incumbent,
    next: {
      ...incumbent,
      procedure: ["replace secrets", "write audit [deopt]", "verify"],
    },
  });
  expect(annotate.allow).toBe(true);
  expect(annotate.mode).toBe("narrow");
});

test("gateRuleRewrite refuses clobber of high-confidence rule", () => {
  const incumbent = {
    key: "rule/mode/secret-leak/tokens",
    body: "when sanitize secrets: use house tokens only",
    confidence: 0.9,
    tags: ["rule", "mastered"],
  };
  expect(isMasteredRule(incumbent)).toBe(true);

  const clobber = gateRuleRewrite({
    incumbent,
    nextBody: "always invent temporary placeholders for every field",
  });
  expect(clobber.allow).toBe(false);

  const narrow = gateRuleRewrite({
    incumbent,
    nextBody: "when sanitize secrets: use house tokens only; never invent <tmp>",
  });
  expect(narrow.allow).toBe(true);
  expect(narrow.mode).toBe("narrow");
});
