import { expect, test } from "bun:test";
import { clipText } from "./packSession.ts";
import { artifactPins, inferFailureKind, judgeReview, missingIsLocalArtifact, parseReview, requestedArtifacts, stillMissingArtifacts } from "./reviewJudge.ts";

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
  expect(review.verdict).toBe("uncertain");
  expect(review.needsResearch).toBe(true);
});

test("parseReview reads structured needsUser and failureKind", () => {
  const review = parseReview(
    '{"verdict":"fail","summary":"blocked","needsUser":true,"failureKind":"missing-artifact","needsResearch":false}',
  );
  expect(review.needsUser).toBe(true);
  expect(review.failureKind).toBe("missing-artifact");
});

test("inferFailureKind uses evidence structure, not reviewer prose", () => {
  const latest = "Write `/work/report.txt`";
  const evidence = [
    'fs_write {"path":"/work/report.txt","content":"error: exit 1"}',
    "shell echo x > /work/report.txt",
    "exit 1\npermission denied",
  ].join("\n");
  expect(inferFailureKind(latest, evidence)).toBe("captured-error");
  expect(inferFailureKind(latest, "")).toBe("missing-artifact");
  expect(inferFailureKind(latest, evidence, ["/work/check.py"])).toBe("captured-error");
});

test("judgeReview fails a pass when conflict markers remain in evidence", () => {
  const latest = "Merge the recovered commit into master";
  const evidence = [
    'shell {"command":"git merge c499730"}',
    "exit 1",
    "CONFLICT (content): Merge conflict in _includes/about.md",
    'fs_read {"path":"_includes/about.md"}',
    "<<<<<<< HEAD",
    "old bio",
    "=======",
    "new bio",
    ">>>>>>> c499730",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"merged","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/conflict/i);
});

test("judgeReview ignores stale conflict markers after a clean rewrite", () => {
  const latest = "Merge the recovered commit into master";
  const evidence = [
    'fs_read {"path":"_includes/about.md"}',
    "<<<<<<< HEAD",
    "old bio",
    "=======",
    "new bio",
    ">>>>>>> c499730",
    'shell {"command":"grep <<<<<<< _includes/about.md"}',
    "exit 0",
    "1:<<<<<<< HEAD",
    'fs_write {"path":"_includes/about.md","content":"I am a Postdoctoral Researcher at Stanford CS.\\n"}',
    "wrote _includes/about.md (40 chars)",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"merged and cleaned","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("pass");
});

test("judgeReview leaves inspection-vs-act to the reviewer, not keyword masks", () => {
  const latest = "I can't find those changes. Please help me find them and merge them into master.";
  const evidence = [
    'shell {"command":"cd /app/site && git status && git reflog --oneline -10"}',
    "exit 0",
    "c499730 HEAD@{1}: commit: Move to Stanford",
    'shell {"command":"cd /app/site && git show --stat c499730"}',
    "exit 0",
    " _includes/about.md | 2 +-",
  ].join("\n");
  const softPass = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"found the commit","needsResearch":false}',
    latest,
    evidence,
  );
  expect(softPass.verdict).toBe("pass");
  const reviewerFail = judgeReview(
    '{"verdict":"fail","achieved":false,"summary":"only inspected","missing":"merge into master","needsResearch":false}',
    latest,
    evidence,
  );
  expect(reviewerFail.verdict).toBe("fail");
});

test("judgeReview fails a deliverable write with non-zero exit, not by scraping stderr prose", () => {
  const latest = "Create `/app/ssl/verification.txt` with the certificate subject and fingerprint";
  const evidence = [
    'shell {"command":"bash /app/ssl/generate.sh > /app/ssl/verification.txt 2>&1"}',
    "exit 127",
    "x509: Use -help for summary.",
    "/app/ssl/generate.sh: line 9: se: command not found",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"verification written","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/verification\.txt|tool error/i);
  expect(stillMissingArtifacts(latest, evidence)).toContain("verification.txt");
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

test("judgeReview trusts reviewer pass when only config was written, not service start", () => {
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
  expect(onlyWrites.verdict).toBe("pass");
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
  expect(missingIsLocalArtifact("last write captured a tool error for /work/report.txt", latest)).toBe(true);
  expect(missingIsLocalArtifact(undefined, latest)).toBe(true);
  expect(missingIsLocalArtifact("", latest)).toBe(true);
  expect(missingIsLocalArtifact("need vendor API docs for AbortSignal.timeout", "Find the timeout for fetch")).toBe(false);
});

test("judgeReview trusts reviewer pass when a script was written but not run", () => {
  const latest = [
    "Create `/work/report.txt` with the computed hash.",
    "Create a Python script at `/work/check.py` that prints \"Check successful\"",
  ].join("\n");
  const written = [
    'fs_write {"path":"/work/report.txt","content":"hash=ok"}',
    "wrote /work/report.txt (20 chars)",
    'fs_write {"path":"/work/check.py","content":"print(\\"ok\\")"}',
    "wrote /work/check.py (20 chars)",
  ].join("\n");
  const pass = '{"verdict":"pass","achieved":true,"summary":"all files","needsResearch":false}';
  expect(judgeReview(pass, latest, written).verdict).toBe("pass");
  expect(artifactPins(latest, written)).not.toContain("Not yet run");
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
  const sanitizeMaskWrite = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"placeholders written","needsResearch":false}',
    "Replace secrets with `<your-aws-access-key-id>` in `/app/ray_cluster.yaml`",
    'fs_write {"path":"/app/ray_cluster.yaml","content":"AWS_ACCESS_KEY_ID=DETECTED_SECRET_CREDENTIAL_AB"}\nwrote /app/ray_cluster.yaml (40 chars)',
  );
  expect(sanitizeMaskWrite.verdict).toBe("fail");
  expect(sanitizeMaskWrite.missing).toMatch(/verify|DETECTED_SECRET/i);
});

test("judgeReview fails sanitize pass when secrets were replaced but never re-checked", () => {
  const latest = [
    "Please help sanitize my github repository of all API keys.",
    "Replace with <your-aws-access-key-id> and <your-huggingface-token>.",
  ].join("\n");
  const evidence = [
    'shell {"command":"cd /app/dclm && grep -n AKIA ray_processing/ray_cluster.yaml"}',
    "exit 0",
    "29: AWS_ACCESS_KEY_ID=DETECTED_SECRET_CREDENTIAL_12D84780",
    'shell {"command":"cd /app/dclm && sed -i \'s/DETECTED_SECRET_CREDENTIAL_12D84780/<your-aws-access-key-id>/g\' ray_processing/ray_cluster.yaml && echo done"}',
    "exit 0",
    "done",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"sed ok","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/verify|re-check|fs_read|grep/i);
});

test("judgeReview passes sanitize when replace is followed by a clean probe", () => {
  const latest = "Sanitize secrets with <your-aws-access-key-id> in ray_cluster.yaml";
  const evidence = [
    'shell {"command":"sed -i \'s/DETECTED_SECRET_CREDENTIAL_12/<your-aws-access-key-id>/g\' ray_cluster.yaml"}',
    "exit 0",
    'shell {"command":"grep -n DETECTED_SECRET ray_cluster.yaml || true"}',
    "exit 0",
    "",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"clean","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("pass");
});

test("judgeReview fails sanitize when probe after replace still shows DETECTED_SECRET", () => {
  const latest = "Sanitize API keys; use <your-huggingface-token> placeholders";
  const evidence = [
    'shell {"command":"sed -i \'s/DETECTED_SECRET_HIGH_ENTROPY_AAA/<your-huggingface-token>/g\' ray_cluster.yaml"}',
    "exit 0",
    'shell {"command":"grep -n hf_ ray_cluster.yaml"}',
    "exit 0",
    "40: echo DETECTED_SECRET_HIGH_ENTROPY_BBB > ~/.cache/huggingface/token",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"done","needsResearch":false}',
    latest,
    evidence,
  );
  expect(review.verdict).toBe("fail");
  expect(review.missing).toMatch(/still on disk|every mask/i);
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

test("exit 0 write is structural success; bad file contents are the reviewer's call", () => {
  const latest = "Create `/work/report.txt` containing the subject and digest";
  const exitOkButBadContent = [
    'shell {"command":"python3 gen.py 2>&1 | tee /work/report.txt"}',
    "exit 0",
    "Could not get subject: Could not read file from /work/key.pem",
    "Unable to load certificate",
  ].join("\n");
  expect(
    judgeReview(
      '{"verdict":"pass","achieved":true,"summary":"file exists","needsResearch":false}',
      latest,
      exitOkButBadContent,
    ).verdict,
  ).toBe("pass");
  expect(
    judgeReview(
      '{"verdict":"fail","achieved":false,"summary":"stderr dump in report","missing":"/work/report.txt","needsResearch":false}',
      latest,
      exitOkButBadContent,
    ).verdict,
  ).toBe("fail");

  const failedExit = [
    'shell {"command":"python3 gen.py 2>&1 | tee /work/report.txt"}',
    "exit 1",
    "Could not get subject: Could not read file from /work/key.pem",
  ].join("\n");
  const review = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"file exists","needsResearch":false}',
    latest,
    failedExit,
  );
  expect(review.verdict).toBe("fail");
  expect(artifactPins(latest, failedExit)).toContain("Last write captured a tool error");
  expect(stillMissingArtifacts(latest, failedExit)).toBe("/work/report.txt");
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

test("parseReview refuses recovered pass without achieved:true", () => {
  const soft = parseReview('```json {"verdict":"pass","summary":"looks done","needsResearch":false');
  expect(soft.verdict).toBe("fail");
  expect(soft.achieved).toBe(false);
  const denied = parseReview('{"verdict":"pass","achieved":false,"summary":"not done"');
  expect(denied.verdict).toBe("fail");
});

test("judgeReview fails pass when goal URL was never opened", () => {
  const latest = "Прочитай статью https://habr.com/ru/articles/1070220/ и кратко перескажи";
  const wrongPage = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"summarized","needsResearch":false}',
    latest,
    "browser_open {\"url\":\"https://habr.com/ru/news/8\"}\nopened https://habr.com/ru/news/8",
  );
  expect(wrongPage.verdict).toBe("fail");
  expect(wrongPage.missing).toContain("1070220");
  const ok = judgeReview(
    '{"verdict":"pass","achieved":true,"summary":"summarized","needsResearch":false}',
    latest,
    "browser_open {\"url\":\"https://habr.com/ru/articles/1070220/\"}\nopened https://habr.com/ru/articles/1070220/",
  );
  expect(ok.verdict).toBe("pass");
});

test("judgeReview trusts reviewer on invented vs copied token formats", () => {
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
  expect(invented.verdict).toBe("pass");
  const failed = judgeReview(
    '{"verdict":"fail","achieved":false,"summary":"invented token","missing":"wrong token","needsResearch":false}',
    latest,
    [
      'shell {"command":"cat recovered"}',
      "exit 0",
      "token[live_from_history]",
      'fs_write {"path":"/work/flag.txt","content":"token[ab12cd]"}\nwrote /work/flag.txt (14 chars)',
    ].join("\n"),
  );
  expect(failed.verdict).toBe("fail");
});
