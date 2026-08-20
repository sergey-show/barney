import { expect, test } from "bun:test";
import { parseTurnRoute } from "./turnMode.ts";

test("analysis JSON decides short chat vs a work plan, not a model lane", () => {
  expect(parseTurnRoute('{"topic":"кто ты","short":true,"need_research":false,"analysis":"","plan":[]}')).toEqual({
    topic: "кто ты",
    short: true,
    needResearch: false,
    analysis: "",
    plan: [],
  });
  expect(parseTurnRoute('{"topic":"время","short":false,"need_research":false}').needResearch).toBe(false);
  expect(parseTurnRoute('{"topic":"docs","short":false,"need_research":true,"analysis":"Need the current API.","plan":["open docs"]}')).toEqual({
    topic: "docs",
    short: false,
    needResearch: true,
    analysis: "Need the current API.",
    plan: ["open docs"],
  });
});

test("need_research forbids a short chat", () => {
  const route = parseTurnRoute('{"topic":"api","short":true,"need_research":true}');
  expect(route.short).toBe(false);
  expect(route.needResearch).toBe(true);
});

test("reads analysis JSON even when wrapped, and maps legacy need_large", () => {
  const fenced = parseTurnRoute('```json\n{"topic":"docs","short":false,"need_research":true}\n```');
  expect(fenced).toEqual({ topic: "docs", short: false, needResearch: true, analysis: "", plan: [] });
  const think = parseTurnRoute('<think>route it</think>\n{"topic":"город","short":false,"need_research":false}');
  expect(think.short).toBe(false);
  expect(parseTurnRoute("need_large: false").short).toBe(true);
  expect(parseTurnRoute('{"topic":"file","need_large":true,"plan":["write report.txt"]}').plan).toEqual(["write report.txt"]);
});

test("unparseable analysis fails open to a full turn without auto-research", () => {
  expect(parseTurnRoute("просто болтовня без json")).toEqual({
    topic: "",
    short: false,
    needResearch: false,
    analysis: "",
    plan: [],
  });
  expect(parseTurnRoute("").needResearch).toBe(false);
});
