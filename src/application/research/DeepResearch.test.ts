import { expect, test } from "bun:test";
import { formatResearchBrief, parseQuestions, runDeepResearch } from "./DeepResearch.ts";

test("falls back to the original query when the plan is not JSON", () => {
  expect(parseQuestions("just think about it", "Jira REST auth")).toEqual(["Jira REST auth"]);
});

test("reads planned questions", () => {
  expect(parseQuestions('{"questions":["Jira REST API auth","Jira DC personal access token"]}', "x"))
    .toEqual(["Jira REST API auth", "Jira DC personal access token"]);
});

test("investigates two sources and synthesizes a brief", async () => {
  const opened: string[] = [];
  const brief = await runDeepResearch({
    query: "Jira REST auth",
    goal: "jira plugin",
    runId: "run-1",
    search: {
      search: async () => "",
      lookup: async () => [
        { title: "Auth", url: "https://developer.atlassian.com/auth", snippet: "PAT" },
        { title: "REST", url: "https://developer.atlassian.com/rest", snippet: "API" },
      ],
    },
    browser: {
      open: async ({ url }) => {
        opened.push(url);
        return { title: "Docs", url, text: "Use a personal access token. https://developer.atlassian.com/auth" };
      },
      read: async () => ({ title: "", url: "", text: "" }),
      screenshot: async () => ({ path: "", url: "", title: "", jpeg: Buffer.from("") }),
      consumeShot: () => null,
      current: () => null,
      click: async () => ({ title: "", url: "", text: "" }),
      fill: async () => ({ title: "", url: "", text: "" }),
      press: async () => ({ title: "", url: "", text: "" }),
      scroll: async () => ({ title: "", url: "", text: "" }),
      close: async () => undefined,
    },
    complete: async (_role, messages) => {
      const system = messages[0]?.content ?? "";
      if (system.includes("Break the question")) {
        return { text: '{"questions":["Jira REST auth"]}', tokens: 10, usd: 0, model: "researcher" };
      }
      return { text: "PAT is required.\n\n## Sources\n- https://developer.atlassian.com/auth", tokens: 20, usd: 0, model: "researcher" };
    },
  });
  expect(opened).toContain("https://developer.atlassian.com/auth");
  expect(brief.text).toContain("PAT");
  expect(formatResearchBrief(brief)).toContain("https://developer.atlassian.com/auth");
  expect(brief.tokens).toBe(30);
});

test("opened page clip keeps the queried API, not the docs chrome", async () => {
  let dossier = "";
  await runDeepResearch({
    query: "bun fetch timeout",
    goal: "timeout",
    runId: "run-clip",
    search: {
      search: async () => "",
      lookup: async () => [{ title: "Fetch", url: "https://bun.sh/docs/fetch", snippet: "" }],
    },
    browser: {
      open: async ({ url }) => ({
        title: "Fetch",
        url,
        text: `${"Skip to content Docs Guides Reference Blog ".repeat(40)} Fetching a URL with a timeout use AbortSignal.timeout(1000)`,
      }),
      read: async () => ({ title: "", url: "", text: "" }),
      screenshot: async () => ({ path: "", url: "", title: "", jpeg: Buffer.from("") }),
      consumeShot: () => null,
      current: () => null,
      click: async () => ({ title: "", url: "", text: "" }),
      fill: async () => ({ title: "", url: "", text: "" }),
      press: async () => ({ title: "", url: "", text: "" }),
      scroll: async () => ({ title: "", url: "", text: "" }),
      close: async () => undefined,
    },
    complete: async (_role, messages) => {
      const user = messages[1]?.content ?? "";
      if (user.includes("Dossier:")) dossier = user;
      if ((messages[0]?.content ?? "").includes("Break the question")) {
        return { text: '{"questions":["bun fetch timeout"]}', tokens: 1, usd: 0 };
      }
      return { text: "unknown — pages did not include a solution", tokens: 1, usd: 0 };
    },
  });
  expect(dossier).toContain("AbortSignal.timeout");
});
