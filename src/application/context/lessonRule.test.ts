import { expect, test } from "bun:test";
import { clipFamily, emptyTrail, lessonRule, noteTrail, pickRules } from "./lessonRule.ts";

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

test("graph neighbors of a fail class reuse a lesson from another task class", () => {
  const lines = pickRules([
    { key: "rule/certs/host", title: "x", body: "[unrun-program] run the checker; do not repeat the failed call.", tags: ["rule", "fail", "certs"] },
    { key: "rule/general/hold", title: "hold", body: "Change tool after a fail.", tags: ["rule", "fail", "general"] },
  ], "login", 3, ["rule/certs/host"]);
  expect(lines[0]).toContain("unrun-program");
});

test("clipFamily keeps a tool family and drops URLs or goal text", () => {
  expect(clipFamily("shell:openssl")).toBe("shell:openssl");
  expect(clipFamily("https://10.0.0.120/ui/")).toBe("");
  expect(clipFamily("openssl genrsa -out /work/key.pem")).toBe("");
});

test("noteTrail records a fail then a different family as recovery", () => {
  const trail = emptyTrail();
  noteTrail(trail, "shell:openssl", true);
  noteTrail(trail, "shell:openssl", true);
  noteTrail(trail, "shell:python3", false);
  expect(trail.failedFamily).toBe("shell:openssl");
  expect(trail.recoveredBy).toBe("shell:python3");
});

test("BLOCKED repeats do not count as recovery", () => {
  const trail = emptyTrail();
  noteTrail(trail, "shell:openssl", true);
  noteTrail(trail, "shell:openssl", true);
  expect(trail.recoveredBy).toBe("");
});

test("fail lessons with a trail name the failed family, not the goal", () => {
  const rule = lessonRule({
    taskClass: "general",
    goal: "write a checker with openssl then python3 /work/check.py",
    verdict: "fail",
    summary: "file exists",
    missing: "no successful run of /work/check.py",
    failClass: "unrun-program",
    failedFamily: "shell:openssl",
  });
  expect(rule.body).toContain("[unrun-program]");
  expect(rule.body).toContain("shell:openssl");
  expect(rule.body).toMatch(/do not repeat shell:openssl/);
  expect(rule.body).not.toMatch(/change path/);
  expect(rule.body).not.toMatch(/check\.py/);
});

test("recovered trail becomes the lesson on pass and fail", () => {
  const fail = lessonRule({
    taskClass: "general",
    goal: "run the checker",
    verdict: "fail",
    summary: "still missing a run",
    missing: "no successful run of /work/check.py",
    failClass: "unrun-program",
    failedFamily: "shell:openssl",
    recoveredBy: "shell:python3",
  });
  expect(fail.body).toMatch(/if shell:openssl fails, do not repeat shell:openssl; next was shell:python3/);

  const pass = lessonRule({
    taskClass: "general",
    goal: "run the checker",
    verdict: "pass",
    summary: "checker ran",
    failedFamily: "shell:openssl",
    recoveredBy: "shell:python3",
  });
  expect(pass.body).toBe("For general: after shell:openssl failed, shell:python3 delivered.");
});

test("repeated family fails crystallize a stronger switch rule", () => {
  const rule = lessonRule({
    taskClass: "general",
    goal: "sanitize secrets",
    verdict: "fail",
    summary: "grep loop",
    failedFamily: "shell:grep",
    familyFailCount: 2,
    sources: ["run-1", "run-2"],
  });
  expect(rule.body).toMatch(/fails twice|switch family/i);
  expect(rule.confidence).toBeGreaterThanOrEqual(0.7);
  expect(rule.sources).toEqual(["run-1", "run-2"]);
});

test("pickRules surfaces a trail lesson", () => {
  const lines = pickRules([
    { key: "rule/general/openssl", title: "x", body: "[unrun-program] if shell:openssl fails, do not repeat shell:openssl.", tags: ["rule", "fail", "general"] },
    { key: "rule/general/hold", title: "hold", body: "Change tool after a fail.", tags: ["rule", "fail", "general"] },
  ], "general", 5);
  expect(lines[0]).toContain("shell:openssl");
});
