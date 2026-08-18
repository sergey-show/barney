import { expect, test } from "bun:test";
import { formatHits, parseSearchHits, unwrapDuckUrl } from "./webSearch.ts";

const html = `
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
<a class="result__snippet" href="#">Official documentation for the API.</a>
<a rel="nofollow" href="https://second.test/page">Second source</a>
`;

test("parses DuckDuckGo result links and unwraps uddg", () => {
  const hits = parseSearchHits(html);
  expect(hits[0]?.url).toBe("https://example.com/docs");
  expect(hits[0]?.title).toBe("Example Docs");
  expect(hits.some((hit) => hit.url === "https://second.test/page")).toBe(true);
});

test("unwraps encoded DuckDuckGo redirect", () => {
  expect(unwrapDuckUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2F10.0.0.120%2Fui%2F"))
    .toBe("https://10.0.0.120/ui/");
});

test("formats hits with full URLs", () => {
  const text = formatHits([{ title: "Host", url: "https://10.0.0.120/ui/", snippet: "panel" }]);
  expect(text).toContain("https://10.0.0.120/ui/");
});
