import { expect, test } from "bun:test";
import { alertDismissKey, classifyClientError, interruptedNotice } from "./alerts.ts";

test("treats fetch failures as a recoverable warning", () => {
  const alert = classifyClientError(new TypeError("Failed to fetch"));
  expect(alert.level).toBe("warning");
  expect(alert.title).toBe("Connection lost");
});

test("surfaces an interrupted system note at the tail", () => {
  const alert = interruptedNotice([
    { kind: "user", text: "open the panel" },
    { kind: "system", text: "Portal restarted; last step was interrupted." },
  ]);
  expect(alert?.level).toBe("warning");
  expect(alert?.title).toBe("Last step did not finish");
});

test("ignores interruption after later work continued", () => {
  const alert = interruptedNotice([
    { kind: "system", text: "Portal restarted; last step was interrupted." },
    { kind: "user", text: "Continue interrupted work" },
    { kind: "thought", text: "resuming" },
  ]);
  expect(alert).toBeNull();
});

test("does not surface interruption on finished sessions", () => {
  const alert = interruptedNotice([
    { kind: "system", text: "Portal restarted; last step was interrupted." },
  ], "done");
  expect(alert).toBeNull();
});

test("dismiss key is scoped to the session", () => {
  expect(alertDismissKey("run-a", { detail: "Portal restarted" }))
    .not.toBe(alertDismissKey("run-b", { detail: "Portal restarted" }));
});
