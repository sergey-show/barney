import { expect, test } from "bun:test";
import { parseTurnRoute } from "./turnMode.ts";

test("small model JSON decides large vs small and research, not a keyword catalog", () => {
  expect(parseTurnRoute('{"topic":"кто ты","need_large":false,"need_research":false}')).toEqual({
    topic: "кто ты",
    needLarge: false,
    needResearch: false,
  });
  expect(parseTurnRoute('{"topic":"время","need_large":true,"need_research":false}').needResearch).toBe(false);
  expect(parseTurnRoute('{"topic":"docs","need_large":true,"need_research":true}')).toEqual({
    topic: "docs",
    needLarge: true,
    needResearch: true,
  });
});

test("need_research implies the large model", () => {
  const route = parseTurnRoute('{"topic":"api","need_research":true}');
  expect(route.needLarge).toBe(true);
  expect(route.needResearch).toBe(true);
});

test("reads route JSON even when the small model wraps it", () => {
  const fenced = parseTurnRoute('```json\n{"topic":"docs","need_large":true,"need_research":true}\n```');
  expect(fenced).toEqual({ topic: "docs", needLarge: true, needResearch: true });
  const think = parseTurnRoute('<think>route it</think>\n{"topic":"город","need_large":true,"need_research":false}');
  expect(think.needLarge).toBe(true);
  expect(think.needResearch).toBe(false);
  expect(parseTurnRoute("need_large: false").needLarge).toBe(false);
});

test("unparseable route fails open to the large model without auto-research", () => {
  expect(parseTurnRoute("просто болтовня без json")).toEqual({
    topic: "",
    needLarge: true,
    needResearch: false,
  });
  expect(parseTurnRoute("").needResearch).toBe(false);
});
