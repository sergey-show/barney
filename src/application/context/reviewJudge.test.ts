import { expect, test } from "bun:test";
import { clipText } from "./packSession.ts";
import { artifactPins, judgeReview, missingIsLocalArtifact, parseReview, requestedArtifacts, stillMissingArtifacts } from "./reviewJudge.ts";

test("parseReview stringifies array missing so clipText does not crash", () => {
  const review = parseReview(
    '{"verdict":"fail","summary":{"note":"incomplete"},"missing":["out.bin","report.txt"]}',
  );
  expect(typeof review.summary).toBe("string");
  expect(typeof review.missing).toBe("string");
  expect(review.missing).toContain("out.bin");
  expect(() => clipText(review.missing || review.summary || "unsolved", 100)).not.toThrow();
});

test("parseReview does not treat chain-of-thought 'pass' as a verdict", () => {
  const review = parseReview("Wait, I need to decide. A pass would be wrong because the table was cut off.");
  expect(review.verdict).toBe("fail");
  expect(review.needsResearch).toBe(false);
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
  const latest = "Create `/work/report.txt` and `/work/check.py`";
  const nested = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"all files created","needsResearch":false}',
    latest,
    'fs_write {"path":"work/report.txt"}\nwrote work/report.txt (878 chars)',
  );
  expect(nested.verdict).toBe("fail");
  expect(nested.missing).toMatch(/report\.txt|check\.py/);
  const done = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}',
    latest,
    [
      'cat > /work/key.pem << EOF',
      'fs_write {"path":"report.txt"}\nwrote report.txt (80 chars)',
      'fs_write {"path":"check.py"}\nwrote check.py (200 chars)',
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

test("judgeReview fails a pass when a listen/start was asked and the service never came up", () => {
  const latest = "Listen on port 8080. Start/restart Nginx. Place the server config in `/etc/nginx/conf.d/benchmark-site.conf`.";
  const onlyWrites = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"prepared for startup","needsResearch":false}',
    latest,
    [
      "cat > /etc/nginx/conf.d/benchmark-site.conf << 'EOF'",
      "    listen 8080;",
      "exit 1",
      "nginx: configuration file /etc/nginx/nginx.conf test failed",
    ].join("\n"),
  );
  expect(onlyWrites.verdict).toBe("fail");
  expect(onlyWrites.missing).toMatch(/8080|start/i);
  const running = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"nginx listening","needsResearch":false}',
    latest,
    [
      "cat > /etc/nginx/conf.d/benchmark-site.conf << 'EOF'",
      "nginx -t",
      "exit 0",
      "nginx: the configuration file /etc/nginx/nginx.conf test is successful",
      "nginx -s reload",
      "exit 0",
    ].join("\n"),
  );
  expect(running.verdict).toBe("pass");
});

test("ls listing and EXISTS count as write evidence, MISSING does not", () => {
  const latest = "Create `/work/key.pem`, `/work/report.txt`, and `/work/check.py`";
  const listing = [
    "ls -la /work/",
    "exit 0",
    "total 24",
    "-rw------- 1 root root 1708 Aug 19 11:18 key.pem",
    "-rw-r--r-- 1 root root 1787 Aug 19 11:19 report.txt",
    "check.py MISSING",
    "report.txt EXISTS",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"all files","needsResearch":false}',
    latest,
    listing,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/check\.py/);
  expect(review.missing).not.toMatch(/key\.pem|report\.txt/);
  expect(artifactPins(latest, listing)).toContain("key.pem");
  expect(artifactPins(latest, listing)).toContain("Not yet written");
  expect(stillMissingArtifacts(latest, listing, "all required files were not created")).toBe("/work/check.py");
});

test("missingIsLocalArtifact is true for worktree files, not vendor docs", () => {
  const latest = "Write `/work/check.py` and `/work/report.txt`";
  expect(missingIsLocalArtifact("/work/check.py is missing from the directory listing", latest)).toBe(true);
  expect(missingIsLocalArtifact("no write of /work/report.txt, /work/check.py", latest)).toBe(true);
  expect(missingIsLocalArtifact("no successful run of /work/check.py", latest)).toBe(true);
  expect(missingIsLocalArtifact("last write captured a tool error for /work/report.txt", latest)).toBe(true);
  expect(missingIsLocalArtifact(undefined, latest)).toBe(true);
  expect(missingIsLocalArtifact("", latest)).toBe(true);
  expect(missingIsLocalArtifact("need vendor API docs for AbortSignal.timeout", "Find the timeout for fetch")).toBe(false);
});

test("judgeReview fails a pass when a requested program was never successfully run", () => {
  const latest = [
    "Create `/work/report.txt` with the computed hash.",
    "Create a Python script at `/work/check.py` that:",
    "- Loads the input file",
    "- Prints the status line",
    "- Prints \"Check successful\" if all checks pass",
  ].join("\n");
  const written = [
    'fs_write {"path":"/work/report.txt","content":"hash=ok"}',
    "wrote /work/report.txt (20 chars)",
    'fs_write {"path":"/work/check.py","content":"print(\\"ok\\")"}',
    "wrote /work/check.py (20 chars)",
  ].join("\n");
  const pass = '{"verdict":"pass","achieved":true,"summary":"all files","needsResearch":false}';
  const onlyWrite = judgeReview(pass, latest, written);
  expect(onlyWrite.verdict).toBe("fail");
  expect(onlyWrite.missing).toMatch(/no successful run of \/work\/check\.py/);
  expect(artifactPins(latest, written)).toContain("Not yet run");
  expect(stillMissingArtifacts(latest, written)).toBe("/work/check.py");

  const failedThenOtherOk = judgeReview(pass, latest, [
    written,
    'shell {"command":"python /work/check.py"}',
    "exit 1",
    "SyntaxError: closing parenthesis",
    'shell {"command":"sha256sum /work/key.pem"}',
    "exit 0",
    "abc123  /work/key.pem",
  ].join("\n"));
  expect(failedThenOtherOk.verdict).toBe("fail");

  const ran = judgeReview(pass, latest, [
    written,
    'shell {"command":"python3 /work/check.py"}',
    "exit 0",
    "Check successful",
  ].join("\n"));
  expect(ran.verdict).toBe("pass");

  const catIsNotARun = judgeReview(pass, latest, [
    written,
    'shell {"command":"cat /work/check.py"}',
    "exit 0",
    "print(\"ok\")",
  ].join("\n"));
  expect(catIsNotARun.verdict).toBe("fail");
});

test("judgeReview fails a pass when the program tracebacked even if the compound command exits 0", () => {
  const latest = "Create a python script `/app/filter.py` that removes JavaScript from HTML files";
  const evidence = [
    'fs_write {"path":"/app/filter.py","content":"print(1)"}',
    "wrote /app/filter.py (20 chars)",
    'shell {"command":"python3 /app/filter.py /app/test.html && cat /app/out.html || echo none"}',
    "exit 0",
    "none",
    "Traceback (most recent call last):",
    "NameError: name 'full_mask' is not defined",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"filter.py written and executed","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/no successful run of \/app\/filter\.py/);
});

test("judgeReview treats a program by the ask, not by extension or interpreter name", () => {
  const latest = "Create a program at `/app/hello.js` that prints hello";
  const written = [
    'fs_write {"path":"/app/hello.js","content":"console.log(\\"hello\\")"}',
    "wrote /app/hello.js (24 chars)",
  ].join("\n");
  const pass = '{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}';
  expect(judgeReview(pass, latest, written).verdict).toBe("fail");
  const ran = judgeReview(pass, latest, [
    written,
    'shell {"command":"node /app/hello.js"}',
    "exit 0",
    "hello",
  ].join("\n"));
  expect(ran.verdict).toBe("pass");
});

test("judgeReview does not require a run when the user only asked to write the file", () => {
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}',
    "Create `/work/report.txt` and `/work/check.py`",
    [
      'fs_write {"path":"report.txt"}\nwrote report.txt (80 chars)',
      'fs_write {"path":"check.py"}\nwrote check.py (200 chars)',
    ].join("\n"),
  );
  expect(review.verdict).toBe("pass");
});

test("judgeReview fails a pass that wrote a DETECTED_SECRET mask into a deliverable", () => {
  const latest = "Create `/work/report.txt` with the SHA-256 digest and `/work/check.py`";
  const evidence = [
    'fs_write {"path":"/work/report.txt","content":"SHA-256: DETECTED_SECRET_SHA256_FINGERPRINT"}',
    "wrote /work/report.txt (190 chars)",
    'fs_write {"path":"/work/check.py","content":"print(\\"ok\\")"}',
    "wrote /work/check.py (20 chars)",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"all files","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/DETECTED_SECRET|live value/i);
  const sanitize = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"placeholders written","needsResearch":false}',
    "Replace secrets with `<your-aws-access-key-id>` in `/app/ray_cluster.yaml`",
    'fs_write {"path":"/app/ray_cluster.yaml","content":"AWS_ACCESS_KEY_ID=DETECTED_SECRET_CREDENTIAL_AB"}\\nwrote /app/ray_cluster.yaml (40 chars)',
  );
  expect(sanitize.verdict).toBe("pass");
});

test("judgeReview does not treat a later secret mask in shell output as a write into an earlier file", () => {
  const latest = [
    "Create `/work/report.txt` with the subject line.",
    "Create a Python script at `/work/check.py` that prints the name.",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}',
    latest,
    [
      'fs_write {"path":"/work/report.txt","content":"subject=ok"}',
      "wrote /work/report.txt (20 chars)",
      'fs_write {"path":"/work/check.py","content":"print(\\"example.local\\")"}',
      "wrote /work/check.py (40 chars)",
      'shell {"command":"python3 /work/check.py"}',
      "exit 0",
      "example.local",
      'shell {"command":"cat /work/key.pem | head -3"}',
      "exit 0",
      "DETECTED_SECRET_PEM_6BC0E7D1",
    ].join("\n"),
  );
  expect(review.verdict).toBe("pass");
});

test("judgeReview does not treat a code dump as an opened docs page", () => {
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}',
    "Create `/work/check.py`",
    [
      'fs_write {"path":"/work/check.py","content":"from some.lib import NameOID\\nprint(NameOID.COMMON_NAME)"}',
      "wrote /work/check.py (80 chars)",
    ].join("\n"),
    "Wrote check.py using a subprocess.",
  );
  expect(review.verdict).toBe("pass");
});

test("judgeReview fails a pass when a redirect captured a tool error into the deliverable", () => {
  const latest = "Create `/work/report.txt` containing the subject and digest";
  const poisoned = [
    'shell {"command":"python3 gen.py 2>&1 | tee /work/report.txt"}',
    "exit 0",
    "Could not get subject: Could not read file from /work/key.pem",
    "Unable to load certificate",
    "Validity dates (YYYY-MM-DD): N/A to N/A",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"file exists","needsResearch":false}',
    latest,
    poisoned,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/tool error|report\.txt/i);
  expect(artifactPins(latest, poisoned)).toContain("Last write captured a tool error");
  expect(artifactPins(latest, poisoned)).not.toContain("Already on disk");
  expect(stillMissingArtifacts(latest, poisoned)).toBe("/work/report.txt");

  const rewritten = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"rewritten","needsResearch":false}',
    latest,
    [
      poisoned,
      'fs_write {"path":"/work/report.txt","content":"subject=Example Org, CN = example"}',
      "wrote /work/report.txt (40 chars)",
    ].join("\n"),
  );
  expect(rewritten.verdict).toBe("pass");
});

test("requestedArtifacts sees a write-path without backticks, not a given input", () => {
  const latest = [
    "You are given a program located at /work/src/legacy.cbl.",
    "Create a script at /work/program.py that reads /work/src/INPUT.DAT.",
    "Write me a program extract.js that runs against the binary.",
    "Save the pattern in /work/regex.txt",
    "Write a single file in /work/polyglot/main.py.c which prints n.",
  ].join("\n");
  const found = requestedArtifacts(latest);
  expect(found).toContain("/work/program.py");
  expect(found).toContain("extract.js");
  expect(found).toContain("/work/regex.txt");
  expect(found).toContain("/work/polyglot/main.py.c");
  expect(found).not.toContain("/work/src/legacy.cbl");
  expect(found).not.toContain("/work/src/INPUT.DAT");
});

test("wanting leftover stays open for a bare write-path until the file exists", () => {
  const latest = "Save the pattern in /work/regex.txt";
  expect(stillMissingArtifacts(latest, "")).toBe("/work/regex.txt");
  expect(stillMissingArtifacts(latest, 'fs_write {"path":"/work/regex.txt","content":"x"}\nwrote /work/regex.txt (1 chars)')).toBe("the requested result");
});

test("parseReview recovers a fenced or truncated reviewer object", () => {
  const fenced = parseReview('```json\n{"verdict":"pass","achieved":true,"summary":"ok","needsResearch":false}\n```');
  expect(fenced.verdict).toBe("pass");
  const truncated = parseReview('```json {"verdict":"pass","achieved":true,"requested":"Create a package called "vectorops", then host it."');
  expect(truncated.verdict).toBe("pass");
});

test("judgeReview fails a pass that invented a token already present in tools", () => {
  const latest = "Recover the token in the format token[...] and write it to /work/flag.txt";
  const invented = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"flag written","needsResearch":false}',
    latest,
    [
      'shell {"command":"cat recovered"}',
      "exit 0",
      "token[live_from_history]",
      'fs_write {"path":"/work/flag.txt","content":"token[ab12cd]"}\nwrote /work/flag.txt (14 chars)',
    ].join("\n"),
  );
  expect(invented.verdict).toBe("fail");
  expect(invented.missing).toMatch(/invented|live value/i);
  const copied = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"flag written","needsResearch":false}',
    latest,
    [
      'shell {"command":"cat recovered"}',
      "exit 0",
      "token[live_from_history]",
      'fs_write {"path":"/work/flag.txt","content":"token[live_from_history]"}\nwrote /work/flag.txt (24 chars)',
    ].join("\n"),
  );
  expect(copied.verdict).toBe("pass");
});

