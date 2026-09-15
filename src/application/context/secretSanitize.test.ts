import { expect, test } from "bun:test";
import {
  askedToReplaceSecrets,
  isSecretSanitizeProgressCall,
  isTreeWideSecretProbe,
  leftoverSecretMasks,
  postSecretMutateObserve,
  requestedPlaceholders,
  secretSanitizePersistNudge,
  sanitizeRejectsGoAhead,
} from "./secretSanitize.ts";
import { applyToolObserve } from "./observeTool.ts";
import { familyKey } from "./controlLoop.ts";

test("requested placeholders prefer user <your-…> strings", () => {
  expect(askedToReplaceSecrets("sanitize keys with <your-aws-access-key-id>")).toBe(true);
  expect(requestedPlaceholders("use <your-aws-access-key-id> and <your-github-token>")).toEqual([
    "<your-aws-access-key-id>",
    "<your-github-token>",
  ]);
});

test("tree-wide probe detects recursive grep", () => {
  expect(isTreeWideSecretProbe('shell {"command":"grep -r DETECTED_SECRET_ . --exclude-dir=.git"}\nexit 0\n')).toBe(true);
  expect(isTreeWideSecretProbe('shell {"command":"grep -n DETECTED_SECRET ray_cluster.yaml"}\nexit 0\n')).toBe(false);
});

test("leftoverSecretMasks requires tree-wide verify and placeholders", () => {
  const latest = "Sanitize with <your-aws-access-key-id>";
  const noVerify = [
    'shell {"command":"sed -i \'s/DETECTED_SECRET_CREDENTIAL_AA/<your-aws-access-key-id>/g\' f.py"}',
    "exit 0",
  ].join("\n");
  expect(leftoverSecretMasks(latest, noVerify)).toMatch(/tree-verify/i);

  const clean = [
    'shell {"command":"sed -i \'s/DETECTED_SECRET_CREDENTIAL_AA/<your-aws-access-key-id>/g\' f.py"}',
    "exit 0",
    'shell {"command":"grep -r DETECTED_SECRET_ . --exclude-dir=.git || true"}',
    "exit 0",
    "",
  ].join("\n");
  expect(leftoverSecretMasks(latest, clean)).toBeUndefined();
});

test("persist nudge forces mutate then tree verify", () => {
  const inventory = 'shell {"command":"grep -r AKIA ."}\nexit 0\n./a: DETECTED_SECRET_CREDENTIAL_12D84780';
  const nudge = secretSanitizePersistNudge("sanitize <your-aws-access-key-id>", inventory);
  expect(nudge).toMatch(/do not wait for go-ahead/i);
  expect(nudge).toMatch(/DETECTED_SECRET_CREDENTIAL_12D84780/);
  expect(nudge).toMatch(/grep -r DETECTED_SECRET_/);
});

test("go-ahead is rejected for sanitize", () => {
  expect(sanitizeRejectsGoAhead("sanitize secrets", "Ready to execute on your go-ahead.")).toBe(true);
});

test("secret sed stays open under wanting saturation", () => {
  const call = {
    name: "shell",
    arguments: {
      command: "sed -i 's/DETECTED_SECRET_CREDENTIAL_12/<your-aws-access-key-id>/g' f.py",
    },
  };
  const familyFails = new Map<string, number>();
  familyFails.set(familyKey(call), 99);
  const blocked = applyToolObserve(call, "exit 0\n", new Set(), familyFails, { secretSanitize: false });
  expect(blocked.skip).toBe(true);
  const open = applyToolObserve(call, "exit 0\n", new Set(), familyFails, { secretSanitize: true });
  expect(open.skip).toBe(false);
  expect(open.out).toMatch(/tree-verify/i);
  expect(isSecretSanitizeProgressCall(call)).toBe(true);
  expect(postSecretMutateObserve(call, "exit 0\n")).toMatch(/tree-verify/i);
});
