import { expect, test } from "bun:test";
import { bumpBacklog, failureClass, learnedSkillDraft, shouldCloseClass, skillDraft } from "./failureClass.ts";

test("defaults to general; aborted is the only special class without kind", () => {
  expect(failureClass({})).toBe("general");
  expect(failureClass({ kind: undefined })).toBe("general");
  expect(failureClass({ aborted: true })).toBe("aborted-unfinished");
});

test("uses structured failureKind from judge/ledger, not prose", () => {
  expect(failureClass({ kind: "masked-deliverable" })).toBe("masked-deliverable");
  expect(failureClass({ kind: "unrun-program" })).toBe("unrun-program");
  expect(failureClass({ kind: "captured-error" })).toBe("captured-error");
  expect(failureClass({ kind: "missing-artifact" })).toBe("missing-artifact");
});

test("closes a class on the second recurrence; learned skill is a recovery path, not a miss mantra", () => {
  const first = bumpBacklog(null, "general");
  expect(shouldCloseClass(first)).toBe(false);
  const second = bumpBacklog(first, "general");
  expect(shouldCloseClass(second)).toBe(true);
  expect(skillDraft("general")).toBeNull();
  expect(skillDraft("url-truncation")).toBeNull();
  expect(learnedSkillDraft("general", { line: "anything" })).toBeNull();
  expect(learnedSkillDraft("unrun-program", {})).toBeNull();
  const learned = learnedSkillDraft("unrun-program", {
    failedFamily: "shell:openssl",
    recoveredBy: "shell:python3",
  });
  expect(learned?.name).toBe("learned-unrun-program");
  expect(learned?.body).toContain("origin: learned");
  expect(learned?.body).toContain("after shell:openssl failed, shell:python3 delivered");
  expect(learned?.body).toContain("Do not edit the kernel");
  expect(learned?.body).not.toMatch(/change path/i);
});
