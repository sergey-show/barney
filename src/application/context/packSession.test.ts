import { expect, test } from "bun:test";
import { packSession, redactSecrets, stripThink } from "./packSession.ts";

test("keeps tool output in the recent window so the next turn can see it", () => {
  const transcript = [];
  for (let i = 0; i < 10; i += 1) {
    transcript.push({ kind: "user", text: `question ${i} about jira` });
    transcript.push({ kind: "assistant", text: `answer ${i} with details` });
  }
  transcript.push({ kind: "console", text: `fs_write ${JSON.stringify({ path: "jira.md", content: "# long" })}\nok` });
  transcript.push({ kind: "console", text: "saved plugin:jira-mcp ui.html (ui=ui.html) in ~/.barney/plugins/." });
  const packed = packSession(transcript, "сделать плагин для jira");
  expect(packed.folded).toBe(8);
  expect(packed.recent.length).toBeGreaterThan(8);
  expect(packed.recent.some((item) => item.content.includes("answer 9"))).toBe(true);
  expect(packed.recent.some((item) => /Tool output:/.test(item.content) && /jira\.md|jira-mcp/.test(item.content))).toBe(true);
  expect(packed.digest).toContain("question 0");
  expect(packed.digest).not.toContain("question 9");
  expect(packed.digest).toContain("jira.md");
  expect(packed.digest).toContain("jira-mcp");
  expect(packed.digest.length).toBeLessThan(4500);
});

test("clips a huge recent assistant reply", () => {
  const packed = packSession([
    { kind: "user", text: "show html" },
    { kind: "assistant", text: "x".repeat(8000) },
  ], "goal");
  expect(packed.folded).toBe(0);
  expect(packed.recent[1]?.content.length ?? 0).toBeLessThan(2500);
});

test("short session still keeps the goal in the digest", () => {
  const packed = packSession([
    { kind: "user", text: "сделай плагин" },
  ], "jira plugin");
  expect(packed.folded).toBe(0);
  expect(packed.recent).toHaveLength(1);
  expect(packed.digest).toContain("Goal: jira plugin");
});

test("pins full URLs and IPs even when the original turn is clipped", () => {
  const transcript = [];
  transcript.push({
    kind: "user",
    text: `${"please inspect ".repeat(40)} see https://10.0.0.120/ui/`,
  });
  transcript.push({ kind: "assistant", text: "ok" });
  for (let i = 0; i < 8; i += 1) {
    transcript.push({ kind: "user", text: `followup ${i}` });
    transcript.push({ kind: "assistant", text: `ack ${i}` });
  }
  const packed = packSession(transcript, "вот esxi хост https://10.0.0.120/ui/");
  expect(packed.anchors).toContain("https://10.0.0.120/ui/");
  expect(packed.digest).toContain("https://10.0.0.120/ui/");
  expect(packed.digest).toContain("10.0.0.120");
});

test("stripThink drops tagged and untagged chain-of-thought", () => {
  expect(stripThink("<think>plan</think>\nDone.")).toBe("Done.");
  const leaked = [
    "The user asked for the model id. I should read the tool output.",
    "Wait, let me look at the identifier field.",
    "I will reply in Russian.",
    "Модель: MacBookPro10,2.",
  ].join("\n\n");
  expect(stripThink(leaked)).toBe("Модель: MacBookPro10,2.");
});

test("redactSecrets strips passwords before memory upsert", () => {
  expect(redactSecrets("user agent пароль 12qwaszx!! and more")).toContain("пароль [redacted]");
  expect(redactSecrets("user agent пароль 12qwaszx!! and more")).not.toContain("12qwaszx");
});
