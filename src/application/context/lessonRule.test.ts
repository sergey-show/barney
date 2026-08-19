import { expect, test } from "bun:test";
import { lessonRule, pickRules } from "./lessonRule.ts";

test("fail lessons are generic and keyed by host when an anchor exists", () => {
  const rule = lessonRule({
    taskClass: "general",
    goal: "открой https://10.0.0.120/ui/ и выведи список",
    verdict: "fail",
    summary: "guessed a shorter URL and gave up",
    missing: "the list",
    anchors: ["https://10.0.0.120/ui/"],
  });
  expect(rule.body).toMatch(/change tool|do not repeat/i);
  expect(rule.body.length).toBeLessThan(200);
  expect(rule.key).toContain("10.0.0.120");
  expect(rule.body).not.toMatch(/MSK|timezone|system_profiler|esxi|AbortSignal/i);
});

test("does not inject a preview or city recipe from the wording of the goal", () => {
  const preview = lessonRule({
    taskClass: "general",
    goal: "создай мини сайт; в сессии есть https://127.0.0.1:7331",
    latest: "открой просмотреть",
    verdict: "fail",
    summary: "HTML file exists but preview failed",
    missing: "open in portal",
    anchors: ["https://127.0.0.1:7331"],
  });
  expect(preview.body).toMatch(/change tool|do not repeat/i);
  expect(preview.body).not.toMatch(/browser_show|plugin_open|never truncate/i);

  const city = lessonRule({
    taskClass: "general",
    goal: "в каком городе ты сейчас находишься?",
    verdict: "fail",
    summary: "guessed a city from a timezone",
    missing: "actual city",
  });
  expect(city.topic).toBe("general");
  expect(city.body).not.toMatch(/timezone is not a city|MSK|Moscow/i);
});

test("class-tagged fail lessons stay generic and match this turn's miss", () => {
  const rule = lessonRule({
    taskClass: "general",
    goal: "write a checker script",
    verdict: "fail",
    summary: "file exists",
    missing: "no successful run of /work/check.py",
    failClass: "unrun-program",
  });
  expect(rule.body).toContain("[unrun-program]");
  expect(rule.body).toMatch(/change path|do not repeat/i);
  expect(rule.body).not.toMatch(/openssl|check_cert/i);
});

test("operator correction becomes a fail-and-recheck rule", () => {
  const rule = lessonRule({
    taskClass: "general",
    goal: "где ты сейчас запущен?",
    latest: "ты ошибся",
    verdict: "fail",
    summary: "guessed the machine",
    operatorCorrected: true,
  });
  expect(rule.body).toMatch(/operator|wrong/i);
});

test("picks fail rules first and skips success recaps", () => {
  const lines = pickRules([
    { key: "rule/general/recap", title: "x", body: "When working on general: Agent successfully answered.", tags: ["rule", "lesson", "general"] },
    { key: "rule/other/x", title: "x", body: "other rule", tags: ["rule", "other"] },
    { key: "rule/general/hold", title: "hold", body: "Change tool after a fail.", tags: ["rule", "fail", "general"] },
  ], "general", 3);
  expect(lines[0]).toBe("Change tool after a fail.");
  expect(lines.join(" ")).not.toContain("successfully answered");
  expect(lines.join(" ")).not.toContain("other rule");
});

test("skips For-general success recaps", () => {
  const lines = pickRules([
    { key: "rule/general/x", title: "x", body: "For general: Agent successfully opened the page.", tags: ["rule", "lesson"] },
    { key: "rule/general/hold", title: "hold", body: "Change tool after a fail.", tags: ["rule", "fail"] },
  ], "general", 3);
  expect(lines).toEqual(["Change tool after a fail."]);
});
