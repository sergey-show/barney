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

test("picks a class-tagged shadow for this miss and keeps two freshest when nothing matches", () => {
  const tagged = pickRelevantLines([
    "[unrun-program] if no successful run of /work/check.py, change path.",
    "Timezone MSK is not a city.",
    "A guess without evidence is a failed turn.",
  ], "run the python script at /work/check.py");
  expect(tagged.join(" ")).toMatch(/unrun-program|check\.py/);
  expect(tagged.join(" ")).not.toContain("MSK");
  const fresh = pickRelevantLines([
    "newest deed",
    "older deed",
    "oldest",
  ], "zzzz with no overlap");
  expect(fresh).toEqual(["newest deed", "older deed"]);
});

test("renderSamostPrompt does not dump unrelated light and shadow", () => {
  const samost = seedSamost();
  samost.shadow.unshift("Локальная памятка fetch врёт — открыть официальную страницу bun.com.");
  samost.shadow.unshift("Timezone MSK is not a city.");
  const prompt = renderSamostPrompt(samost, "обрыв fetch в Bun через 5 секунд");
  expect(prompt).toContain("bun.com");
  expect(prompt).not.toContain("Timezone MSK");
  expect(prompt).not.toMatch(/Jung|Sartre|Leontiev|Camus/i);
});
