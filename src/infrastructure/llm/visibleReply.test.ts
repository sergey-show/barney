import { expect, test } from "bun:test";
import { peelUntaggedThinking, visibleAssistantText } from "./visibleReply.ts";

const hermesDump = [
  "The previous turn, I said: 'Ты запущен на MacBook Pro с чипом Apple M4 Pro.' and provided a link. I should check what was returned in the system_profiler output.",
  "Wait, let me look at the [success] block.",
  "```json\n{\"Model Name\":\"MacBook Pro\",\"Model Identifier\":\"MacBookPro10,2\"}\n```",
  "Ah! Looking closely at the shell output. I missed the Model ID in my previous response. Let's stick to exactly what the tool returned.",
  "I will reply in Russian. 'Точная модель: MacBook Pro (идентификатор модели в системе: MacBookPro10,2).' Add processor info if helpful. I will output concise confirmation.",
  "Точная модель из системного идентификатора: MacBook Pro (Model ID: MacBookPro10,2, что соответствует модели Mid 2014). Процессор — Intel Core i7 (8-ядерный).",
].join("\n\n");

test("peels Hermes-style English planning from a Russian reply", () => {
  const split = peelUntaggedThinking(hermesDump);
  expect(split.text).toContain("Точная модель из системного идентификатора");
  expect(split.text).not.toContain("I will reply in Russian");
  expect(split.text).not.toContain("Wait, let me look");
  expect(split.thinking).toContain("I should check");
  expect(split.thinking).toContain("I will reply in Russian");
});

test("keeps a normal Russian answer intact", () => {
  const text = "Бот запущен на этом Mac, портал слушает 127.0.0.1:7331.";
  expect(peelUntaggedThinking(text)).toEqual({ text, thinking: "" });
});

test("keeps a normal English answer intact", () => {
  const text = "The server is running on 127.0.0.1:7331.\n\nUse the portal tab to inspect sessions.";
  expect(peelUntaggedThinking(text)).toEqual({ text, thinking: "" });
});

test("does not treat 'the user interface' as chain-of-thought", () => {
  const text = "The user interface should use Inter.\n\nAlso increase contrast on the sidebar.";
  expect(peelUntaggedThinking(text)).toEqual({ text, thinking: "" });
});

test("keeps a short first-person answer", () => {
  const text = "I will check the logs next.";
  expect(peelUntaggedThinking(text)).toEqual({ text, thinking: "" });
});

test("visibleAssistantText falls back to the original when nothing peels", () => {
  expect(visibleAssistantText("ok")).toBe("ok");
});

test("peels verification dumped after a finished reply", () => {
  const leaked = [
    "## Геолокация",
    "Часовой пояс: Europe/Moscow.",
    "4. Check against Evidence & Constraints: - Matches evidence? Yes.",
    "The prompt says \"Rewrite the visible reply so it matches the evidence.\" I will produce just the markdown block.",
  ].join("\n\n");
  const split = peelUntaggedThinking(leaked);
  expect(split.text).toContain("Europe/Moscow");
  expect(split.text).not.toContain("Check against Evidence");
  expect(split.text).not.toContain("The prompt says");
  expect(split.thinking).toContain("Check against Evidence");
});

test("splits orphan </think> so the tag never reaches the user", () => {
  const leaked = "Self-Correction/Verification during thought:\nIDs look fine.\n</think>\n\n## Отчёт\nХост: MacBook-Pro.local.";
  const split = peelUntaggedThinking(leaked);
  expect(split.text).toContain("MacBook-Pro.local");
  expect(split.text).not.toContain("</think>");
  expect(split.text).not.toContain("Self-Correction");
});

test("strips a leaked meta sentence from an otherwise visible paragraph", () => {
  const leaked = "Команда open не открыла Finder: нет окна Quartz. I should state this clearly and concisely. Домашняя папка: /Users/sergey/.";
  expect(visibleAssistantText(leaked)).toContain("/Users/sergey/");
  expect(visibleAssistantText(leaked)).not.toContain("I should state this");
});

test("hides a tool-loop scratchpad that was dumped as the whole reply", () => {
  const leaked = "The first search had no results, let me try other sources — web_search on the second source and also open pages directly. Let me try searching for 'тень' in different contexts — философское значение (Юнг), физическое значение, этимологическое.";
  const split = peelUntaggedThinking(leaked);
  expect(split.text).toBe("");
  expect(split.thinking).toContain("web_search");
  expect(visibleAssistantText(leaked)).toBe("");
});
