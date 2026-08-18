import { expect, test } from "bun:test";
import { bumpBacklog, failureClass, shouldCloseClass, skillDraft } from "./failureClass.ts";

test("does not name eval tickets; aborted is the only special class", () => {
  expect(failureClass({ missing: "invalid url http://127.:0.:733/", summary: "truncated" })).toBe("general");
  expect(failureClass({ summary: "said Moscow from MSK" })).toBe("general");
  expect(failureClass({ summary: "AbortSignal omitted" })).toBe("general");
  expect(failureClass({ aborted: true })).toBe("aborted-unfinished");
});

test("closes a class on the second recurrence without drafting a task skill", () => {
  const first = bumpBacklog(null, "general");
  expect(shouldCloseClass(first)).toBe(false);
  const second = bumpBacklog(first, "general");
  expect(shouldCloseClass(second)).toBe(true);
  expect(skillDraft("general")).toBeNull();
  expect(skillDraft("url-truncation")).toBeNull();
});
