import { expect, test } from "bun:test";
import {
  admitNewProvider,
  canRewriteProvider,
  graduateProviderStatus,
  providerEligibleForRun,
  recordProviderOutcome,
} from "./providerStability.ts";

test("new provider starts quarantine and is not runnable", () => {
  const p = admitNewProvider({
    name: "house-check",
    port: "verify",
    invoke: { kind: "shell", command: "./verify.sh" },
  });
  expect(p.status).toBe("quarantine");
  expect(providerEligibleForRun(p)).toBe(false);
  expect(canRewriteProvider(p)).toBe(true);
});

test("exam wins graduate quarantine → verified → frozen", () => {
  let p = admitNewProvider({
    name: "house-check",
    port: "verify",
    invoke: { kind: "shell", command: "./verify.sh" },
  });
  p = recordProviderOutcome(p, { success: true, transfer: true });
  expect(p.status).toBe("frozen");
  expect(providerEligibleForRun(p)).toBe(true);
  expect(canRewriteProvider(p)).toBe(false);
});

test("fail does not graduate", () => {
  let p = admitNewProvider({
    name: "flaky",
    port: "verify",
    invoke: { kind: "shell", command: "./verify.sh" },
  });
  p = recordProviderOutcome(p, { success: false });
  expect(p.status).toBe("quarantine");
  expect(p.fails).toBe(1);
  expect(graduateProviderStatus(p).status).toBe("quarantine");
});
