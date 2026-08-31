import { expect, test } from "bun:test";
import { bindFsWriteArgs, ensureToolEvidence, extractToolEvidence } from "./toolEvidence.ts";

const PWD = "/Users/sergey/Documents/AI/barney_bot";
const FP =
  "sha256 Fingerprint=8D:85:5F:7D:AE:4B:2B:1F:E4:A5:AE:8B:20:89:4E:CF:1E:05:E0:FA:39:16:38:61:BE:32:E9:40:7E:B7:A5:BD";
const FP_HEX = "8D:85:5F:7D:AE:4B:2B:1F:E4:A5:AE:8B:20:89:4E:CF:1E:05:E0:FA:39:16:38:61:BE:32:E9:40:7E:B7:A5:BD";

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

test("bindFsWriteArgs does not rewrite file content", () => {
  const mangled = `Subject: O = DevOps Team\nsha256 Fingerprint=8D:85:5F:7D`;
  const py = "#!/usr/bin/env python3\nprint('ok')\n";
  const noise = ["/bin/sh: 1: Syntax error: Unterminated quoted string", FP];
  expect(bindFsWriteArgs("fs_write", { path: "/app/ssl/verification.txt", content: mangled }, [FP]).content).toBe(mangled);
  expect(bindFsWriteArgs("fs_write", { path: "/app/check_cert.py", content: py }, noise).content).toBe(py);
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
