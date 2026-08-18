import { expect, test } from "bun:test";
import { pageCodeIdents, parseReplyCheck, replyOmitsPageCode } from "./verifyReply.ts";

test("reads a JSON mismatch", () => {
  const check = parseReplyCheck('{"ok":true,"mismatches":["said M4 Pro; tool says MacBookPro10,2"]}');
  expect(check.ok).toBe(false);
  expect(check.mismatches[0]).toContain("MacBookPro10,2");
});

test("passes a clean verdict", () => {
  expect(parseReplyCheck('{"ok":true,"mismatches":[]}')).toEqual({ ok: true, mismatches: [] });
});

test("requires the documented API from the opened page", () => {
  const page = "use AbortSignal.timeout:\nfetch(url, { signal: AbortSignal.timeout(1000) })";
  expect(pageCodeIdents(page)).toContain("AbortSignal.timeout");
  expect(replyOmitsPageCode("use AbortController and setTimeout", page, "fetch timeout")).toContain("AbortSignal.timeout");
  expect(replyOmitsPageCode("fetch(url, { signal: AbortSignal.timeout(5000) })", page, "fetch timeout")).toBeUndefined();
});
