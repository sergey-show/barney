import { expect, test } from "bun:test";
import { judgeReview, parseReview } from "./reviewJudge.ts";

test("parseReview does not treat chain-of-thought 'pass' as a verdict", () => {
  const review = parseReview("Wait, I need to decide. A pass would be wrong because the table was cut off.");
  expect(review.verdict).toBe("fail");
});

test("judgeReview trusts the reviewer JSON, not user wording", () => {
  const review = judgeReview('{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}', "that's wrong");
  expect(review.verdict).toBe("pass");
});

test("judgeReview fails a pass that used a workaround instead of the page API", () => {
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"format ok","needsResearch":false}',
    "Find the timeout for fetch in bun.sh",
    "opened https://bun.sh/docs/runtime/networking/fetch\nuse AbortSignal.timeout",
    "const c = new AbortController(); setTimeout(() => c.abort(), 5000);",
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toContain("AbortSignal.timeout");
});
