import { expect, test } from "bun:test";
import {
  absoluteFilePathsInCommand,
  checkFailedPaths,
  clearLedger,
  commandReferencesPath,
  failedEditPaths,
  markCheckFailed,
  markFailedEdit,
  markPassedRun,
  markUnverified,
  redirectTargetsInCommand,
  runOutputLooksIncomplete,
  trackMutated,
  trackedPathsInCommand,
  validationPinLine,
  wasPassedRun,
} from "./validationLedger.ts";

test("trackedPathsInCommand uses session-mutated paths, not extensions", () => {
  clearLedger("run_paths");
  trackMutated("run_paths", "/app/check_cert.py");
  trackMutated("run_paths", "/app/verification.txt");
  expect(trackedPathsInCommand("run_paths", "python3 /app/check_cert.py")).toEqual(["/app/check_cert.py"]);
  expect(trackedPathsInCommand("run_paths", "cat /app/verification.txt")).toEqual(["/app/verification.txt"]);
  expect(trackedPathsInCommand("run_paths", "ls /tmp")).toEqual([]);
});

test("commandReferencesPath matches full path or basename", () => {
  expect(commandReferencesPath("python3 /app/check_cert.py", "/app/check_cert.py")).toBe(true);
  expect(commandReferencesPath("python3 check_cert.py", "/app/check_cert.py")).toBe(true);
});

test("runOutputLooksIncomplete is empty stdout only", () => {
  expect(runOutputLooksIncomplete("")).toBe(true);
  expect(runOutputLooksIncomplete("(no output)")).toBe(true);
  expect(runOutputLooksIncomplete("CN: N/A\nExpiration: N/A")).toBe(false);
});

test("ledger tracks passed run vs unverified rewrite", () => {
  clearLedger("run_x");
  markPassedRun("run_x", "/app/check_cert.py");
  expect(wasPassedRun("run_x", "/app/check_cert.py")).toBe(true);
  markUnverified("run_x", "/app/check_cert.py");
  expect(wasPassedRun("run_x", "/app/check_cert.py")).toBe(false);
  expect(validationPinLine("run_x", ["/app/check_cert.py"])).toMatch(/not validated/);
});

test("failed edit paths are tracked per run", () => {
  clearLedger("run_y");
  markFailedEdit("run_y", "script.py");
  expect(failedEditPaths("run_y")).toEqual(["script.py"]);
});

test("checkFailed pins and clears on passed run", () => {
  clearLedger("run_z");
  markCheckFailed("run_z", "/app/broken.py");
  expect(checkFailedPaths("run_z")).toEqual(["/app/broken.py"]);
  expect(validationPinLine("run_z", ["/app/broken.py"])).toMatch(/Check failed on/);
  markPassedRun("run_z", "/app/broken.py");
  expect(checkFailedPaths("run_z")).toEqual([]);
});

test("redirectTargetsInCommand finds > and tee targets", () => {
  expect(redirectTargetsInCommand("echo x > /app/out.txt")).toEqual(["/app/out.txt"]);
  expect(redirectTargetsInCommand("cmd 2>&1")).toEqual([]);
  expect(redirectTargetsInCommand("tee /work/site.conf")).toEqual(["/work/site.conf"]);
});

test("absoluteFilePathsInCommand finds file-like absolute paths", () => {
  expect(absoluteFilePathsInCommand("sed -i s/a/b/ /work/config.conf")).toEqual(["/work/config.conf"]);
  expect(absoluteFilePathsInCommand("openssl x509 -in /app/ssl/server.crt -fingerprint")).toEqual(["/app/ssl/server.crt"]);
  expect(absoluteFilePathsInCommand("true")).toEqual([]);
});
