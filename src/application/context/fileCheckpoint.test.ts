import { expect, test } from "bun:test";
import {
  clearCheckpoints,
  hasRestore,
  rememberGood,
  rememberPrevious,
  restoreBody,
} from "./fileCheckpoint.ts";

test("checkpoint prefers last good over previous", () => {
  clearCheckpoints("run_a");
  rememberPrevious("run_a", "/app/check_cert.py", "prev");
  rememberGood("run_a", "/app/check_cert.py", "good body");
  expect(restoreBody("run_a", "/app/check_cert.py")).toEqual({ content: "good body", source: "good" });
  expect(hasRestore("run_a", "/app/check_cert.py")).toBe(true);
});

test("without good, restore uses previous", () => {
  clearCheckpoints("run_b");
  rememberPrevious("run_b", "script.py", "old");
  expect(restoreBody("run_b", "script.py")).toEqual({ content: "old", source: "previous" });
});
