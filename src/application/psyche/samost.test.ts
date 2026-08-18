import { expect, test } from "bun:test";
import { pickRelevantLines, renderSamostPrompt, seedSamost } from "./samost.ts";

test("picks shadow that matches this turn, not the whole archive", () => {
  const lines = pickRelevantLines([
    "Локальная памятка bun-fetch может врать — брать AbortSignal с официальной страницы.",
    "MSK is not a city.",
    "Не затирать чужой файл.",
  ], "нужен обрыв Bun fetch через 5 секунд", 2);
  expect(lines.join(" ")).toMatch(/AbortSignal|bun-fetch/i);
  expect(lines.join(" ")).not.toContain("MSK");
});

test("renderSamostPrompt does not dump unrelated light and shadow", () => {
  const samost = seedSamost();
  samost.shadow.unshift("Локальная памятка fetch врёт — открыть официальную страницу bun.com.");
  samost.shadow.unshift("Timezone MSK is not a city.");
  const prompt = renderSamostPrompt(samost, "обрыв fetch в Bun через 5 секунд");
  expect(prompt).toContain("bun.com");
  expect(prompt).not.toContain("Timezone MSK");
});
