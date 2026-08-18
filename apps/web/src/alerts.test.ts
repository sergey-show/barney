import { expect, test } from "bun:test";
import { classifyClientError, interruptedNotice } from "./alerts.ts";

test("treats fetch failures as a recoverable warning", () => {
  const alert = classifyClientError(new TypeError("Failed to fetch"));
  expect(alert.level).toBe("warning");
  expect(alert.title).toBe("Connection lost");
});

test("surfaces an interrupted system note", () => {
  const alert = interruptedNotice([
    { kind: "user", text: "open the panel" },
    { kind: "system", text: "Portal restarted; last step was interrupted." },
  ]);
  expect(alert?.level).toBe("warning");
  expect(alert?.title).toBe("Last step did not finish");
});
