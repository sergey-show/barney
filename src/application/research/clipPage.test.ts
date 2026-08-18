import { expect, test } from "bun:test";
import { clipPage, queryTerms } from "./clipPage.ts";

const DOCS = [
  "Skip to content Docs Guides Reference Blog Search docs Install Runtime Package Manager Bundler Test Runner",
  "Get Started Welcome to Bun Installation Quickstart TypeScript bun init bun create",
  "Fetching a URL with a timeout To fetch a URL with a timeout, use AbortSignal.timeout:",
  'const response = await fetch("http://example.com", { signal: AbortSignal.timeout(1000) });',
  "Canceling a request To cancel a request, use an AbortController.",
].join(" ");

test("keeps the timeout section instead of the docs chrome", () => {
  const clipped = clipPage(DOCS, "Bun fetch timeout 5 seconds bun.sh", 400);
  expect(clipped).toContain("AbortSignal.timeout");
  expect(clipped.startsWith("Skip to content")).toBe(false);
});

test("drops filler words from the query", () => {
  expect(queryTerms("Find the current timeout solution in the bun.sh docs")).toContain("timeout");
  expect(queryTerms("Find the current timeout solution in the bun.sh docs")).not.toContain("the");
});
