import { expect, test } from "bun:test";
import { bumpBacklog, failureClass, learnedSkillDraft, shouldCloseClass, skillDraft } from "./failureClass.ts";

test("does not name eval tickets; aborted is the only eval-shaped special class", () => {
  expect(failureClass({ missing: "invalid url http://127.:0.:733/", summary: "truncated" })).toBe("general");
  expect(failureClass({ summary: "said Moscow from MSK" })).toBe("general");
  expect(failureClass({ summary: "AbortSignal omitted" })).toBe("general");
  expect(failureClass({ aborted: true })).toBe("aborted-unfinished");
});

test("names turn-law misses, not benchmark files", () => {
  expect(failureClass({ missing: "wrote DETECTED_SECRET mask into /work/report.txt instead of the live value" })).toBe("masked-deliverable");
  expect(failureClass({ missing: "no successful run of /work/check.py" })).toBe("unrun-program");
  expect(failureClass({ missing: "last write captured a tool error for /work/report.txt" })).toBe("captured-error");
  expect(failureClass({ missing: "no write of /work/report.txt" })).toBe("missing-artifact");
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
