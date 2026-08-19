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

test("judgeReview fails a pass when requested files were not written", () => {
  const latest = "Create `/app/ssl/verification.txt` and `/app/check_cert.py`";
  const nested = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"all files created","needsResearch":false}',
    latest,
    'fs_write {"path":"app/ssl/verification.txt"}\nwrote app/ssl/verification.txt (878 chars)',
  );
  expect(nested.verdict).toBe("fail");
  expect(nested.missing).toMatch(/verification\.txt|check_cert\.py/);
  const done = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}',
    latest,
    [
      'openssl genrsa -out /app/ssl/server.key 2048',
      'fs_write {"path":"ssl/verification.txt"}\nwrote ssl/verification.txt (80 chars)',
      'fs_write {"path":"check_cert.py"}\nwrote check_cert.py (200 chars)',
    ].join("\n"),
  );
  expect(done.verdict).toBe("pass");
});

test("judgeReview accepts sed/cat writes and ignores runtime log sinks", () => {
  const latest = "Configure `/etc/nginx/nginx.conf` and `/etc/nginx/conf.d/benchmark-site.conf`; log to `/var/log/nginx/benchmark-access.log`";
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"nginx ready","needsResearch":false}',
    latest,
    [
      "sed -i '40a log_format benchmark' /etc/nginx/nginx.conf",
      "cat > /etc/nginx/conf.d/benchmark-site.conf << 'EOF'",
    ].join("\n"),
  );
  expect(review.verdict).toBe("pass");
});
