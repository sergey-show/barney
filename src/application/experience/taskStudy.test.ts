import { expect, test } from "bun:test";
import {
  extractStudyDirectives,
  isGreetingRoute,
  planStudyWrite,
  shouldForceTaskStudy,
  studyNoteKey,
} from "./taskStudy.ts";
import type { ExperienceRecallBags } from "./experienceRecall.ts";

const empty: ExperienceRecallBags = { shadow: [], rules: [], skills: [], episodeLines: [] };
const hit: ExperienceRecallBags = {
  shadow: ["[fail:x] tip"],
  rules: [],
  skills: [],
  episodeLines: [],
};

test("forces study on fresh + empty bags when policy allows", () => {
  const d = shouldForceTaskStudy({
    reuse: "fresh",
    bags: empty,
    researchOn: ["gap", "unknown_api", "new_task_class"],
  });
  expect(d.force).toBe(true);
  expect(d.line).toContain("force_research");
  expect(d.line).toContain("study task before act");
});

test("does not force when bags hit or reuse is not fresh", () => {
  expect(shouldForceTaskStudy({
    reuse: "fresh",
    bags: hit,
    researchOn: ["new_task_class"],
  }).force).toBe(false);
  expect(shouldForceTaskStudy({
    reuse: "transfer",
    bags: empty,
    researchOn: ["new_task_class"],
  }).force).toBe(false);
  expect(shouldForceTaskStudy({
    reuse: "fresh",
    bags: empty,
    researchOn: ["gap"],
  }).force).toBe(false);
  expect(shouldForceTaskStudy({
    reuse: "fresh",
    bags: empty,
    researchOn: ["new_task_class"],
    allowSkip: true,
  }).force).toBe(false);
});

test("greeting detection skips study", () => {
  expect(isGreetingRoute("кто ты", "кто ты?")).toBe(true);
  expect(isGreetingRoute("hi", "hello")).toBe(true);
  expect(isGreetingRoute("api", "wire the Stripe webhook from their docs")).toBe(false);
});

test("extractStudyDirectives keeps actionable lines", () => {
  const brief = [
    "Deep research: stripe webhook",
    "Use the Stripe CLI `stripe listen --forward-to` to tunnel events.",
    "Prefer signing secret from Dashboard → Developers → Webhooks.",
    "Do not invent endpoint paths; copy from Opened docs.",
    "hello there short",
    "## Sources",
    "- https://stripe.com/docs — official",
  ].join("\n");
  const dirs = extractStudyDirectives(brief);
  expect(dirs.length).toBeGreaterThanOrEqual(2);
  expect(dirs.some((d) => /stripe listen/i.test(d))).toBe(true);
  expect(dirs.every((d) => !/^https?:/i.test(d))).toBe(true);
});

test("planStudyWrite mints study body and rule lines", () => {
  const plan = planStudyWrite({
    brief: [
      "Deep research: foo",
      "Use `npm install foo` then call FooClient.create with apiKey.",
      "Prefer official docs over blog posts for the create flag.",
    ].join("\n"),
    goal: "integrate Foo SDK",
    runId: "run-1",
  });
  expect(plan.studyBody.length).toBeGreaterThan(40);
  expect(plan.directives.length).toBeGreaterThan(0);
  expect(plan.directives[0]).toContain("[from study run-1]");
  expect(studyNoteKey("devops", "integrate Foo SDK")).toMatch(/^study\/devops\//);
});
