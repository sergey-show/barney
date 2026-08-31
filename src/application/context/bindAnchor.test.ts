import { expect, test } from "bun:test";
import { bindToolArgs, bindUrl, goalAnchors } from "./bindAnchor.ts";

const ANCHOR = "http://127.0.0.1:7331/";

test("replaces truncated localhost with the session anchor", () => {
  expect(bindUrl("http://127.:0.:733/", [ANCHOR])).toBe(ANCHOR);
  expect(bindUrl("http://127...", [ANCHOR])).toBe(ANCHOR);
  expect(bindUrl("http://127.0.0.1:733/", [ANCHOR])).toBe(ANCHOR);
});

test("keeps a complete matching URL", () => {
  expect(bindUrl(ANCHOR, [ANCHOR])).toBe(ANCHOR);
  expect(bindUrl("https://bun.sh/docs/runtime/networking/fetch", [ANCHOR])).toBe(
    "https://bun.sh/docs/runtime/networking/fetch",
  );
});

test("rewrites browser_open and shell args", () => {
  expect(bindToolArgs("browser_open", { url: "http://127.:0.:733/" }, [ANCHOR]).url).toBe(ANCHOR);
  expect(String(bindToolArgs("shell", { command: "curl -s http://127.../health" }, [ANCHOR]).command)).toContain(ANCHOR);
});

test("goalAnchors keep only http facts", () => {
  const found = goalAnchors("открой http://127.0.0.1:7331/ и скажи URL");
  expect(found.some((item) => item.includes("127.0.0.1:7331"))).toBe(true);
});

test("expands a truncated numeric path id from a session anchor", () => {
  const full = "https://habr.com/ru/articles/1070220/";
  expect(bindUrl("https://habr.com/ru/articles/8", [full])).toBe(full);
  expect(bindUrl("https://habr.com/ru/news/8", [full])).toBe("https://habr.com/ru/news/8");
});
