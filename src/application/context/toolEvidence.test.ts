import { expect, test } from "bun:test";
import { bindFsWriteArgs, ensureToolEvidence, extractToolEvidence, pinRelatedEvidence } from "./toolEvidence.ts";

const PWD = "/Users/sergey/Documents/AI/barney_bot";
const FP =
  "sha256 Fingerprint=8D:85:5F:7D:AE:4B:2B:1F:E4:A5:AE:8B:20:89:4E:CF:1E:05:E0:FA:39:16:38:61:BE:32:E9:40:7E:B7:A5:BD";
const FP_HEX = "8D:85:5F:7D:AE:4B:2B:1F:E4:A5:AE:8B:20:89:4E:CF:1E:05:E0:FA:39:16:38:61:BE:32:E9:40:7E:B7:A5:BD";
const SHORT_FP = "sha256 Fingerprint=8D:85:5F:7D:AE:4B:2B:1F:E4:A5:AE:8B:20:89:4E:CF:1E:05:E0:FA";

test("extractToolEvidence keeps stdout lines, not the tool head or exit code", () => {
  expect(extractToolEvidence(`shell ${JSON.stringify({ command: "pwd" })}\nexit 0\n${PWD}\n`)).toEqual([PWD]);
});

test("ensureToolEvidence appends the exact tool line when the model rewrote it", () => {
  const raw = "Мы в /Users/сергеев/Документы/АИ/barney_bot";
  const out = ensureToolEvidence(raw, [PWD]);
  expect(out).toContain(raw);
  expect(out).toContain(PWD);
});

test("ensureToolEvidence works for any tool atom, not only paths", () => {
  expect(ensureToolEvidence("модель примерно MacBookPro1O,2", ["MacBookPro10,2"])).toContain("MacBookPro10,2");
});

test("ensureToolEvidence does not duplicate an already exact copy", () => {
  expect(ensureToolEvidence(`cwd ${PWD}`, [PWD])).toBe(`cwd ${PWD}`);
});

test("pinRelatedEvidence appends the full tool line when a prefix is already present", () => {
  const mangled = `Subject: O = DevOps Team\n${SHORT_FP}`;
  const out = pinRelatedEvidence(mangled, [FP]);
  expect(out).toContain(mangled);
  expect(out).toContain(FP);
});

test("pinRelatedEvidence does not repair unrelated formats or bare digests", () => {
  const bare = "a5ade90303b0870b6fa14d4e00a254a3c5df1ede55a0b6e55d5d823755ed2ae1";
  const raw = `SHA-256 Fingerprint: ${bare}`;
  expect(pinRelatedEvidence(raw, [FP])).toBe(raw);
});

test("pinRelatedEvidence does not dump evidence into unrelated files", () => {
  const py = "#!/usr/bin/env python3\nprint('Certificate verification successful')\n";
  expect(pinRelatedEvidence(py, [FP, PWD])).toBe(py);
});

test("pinRelatedEvidence appends a path only when a fragment is already present", () => {
  const raw = "cwd /Users/sergey/Documents/AI/barney";
  expect(pinRelatedEvidence(raw, [PWD])).toContain(PWD);
});

test("bindFsWriteArgs pins lines the model already partially copied", () => {
  const mangled = `Subject: O = DevOps Team\n${SHORT_FP}`;
  const bound = bindFsWriteArgs("fs_write", { path: "/app/ssl/verification.txt", content: mangled }, [FP]);
  expect(String(bound.content)).toContain(FP);
});

test("bindFsWriteArgs leaves clean python alone", () => {
  const py = "#!/usr/bin/env python3\nprint('ok')\n";
  const bound = bindFsWriteArgs("fs_write", { path: "/app/check_cert.py", content: py }, [FP]);
  expect(bound.content).toBe(py);
});

test("bindFsWriteArgs leaves non-write tools alone", () => {
  const args = { path: "." };
  expect(bindFsWriteArgs("fs_list", args, [FP])).toBe(args);
});

test("extractToolEvidence prefers longer lines when capping atoms", () => {
  const junk = Array.from({ length: 30 }, (_, i) => `noise-${i}`);
  const body = [...junk, FP].join("\n");
  const atoms = extractToolEvidence(body);
  expect(atoms.some((atom) => atom.includes(FP_HEX))).toBe(true);
});

test("extractToolEvidence skips harness noise, not tool facts", () => {
  const atoms = extractToolEvidence([
    "Observe: Tool failed. Read the error, change tool or arguments, do not repeat this exact call",
    FP,
  ].join("\n"));
  expect(atoms).toEqual([FP]);
});
