import { expect, test } from "bun:test";
import {
  commandMatchesPrefix,
  emptyExecPolicy,
  evaluateExecPolicy,
  proposeAmendmentFromApproval,
  upsertAmendment,
} from "./ExecPolicyAmendment.ts";

test("hard deny still wins over allow amendment", () => {
  let store = emptyExecPolicy();
  const proposal = proposeAmendmentFromApproval("sudo ls");
  expect(proposal).toBeNull();
  store = upsertAmendment(store, {
    id: "x",
    kind: "allow_prefix",
    prefix: "sudo ls",
    source: "operator",
    createdAt: new Date().toISOString(),
    refs: [],
  });
  const result = evaluateExecPolicy("sudo ls", store.amendments);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("privileged");
});

test("allow prefix matches and deny prefix blocks", () => {
  expect(commandMatchesPrefix("npm test --watch", "npm test")).toBe(true);
  const allow = proposeAmendmentFromApproval("npm test");
  expect(allow?.prefix).toBe("npm test");
  const store = upsertAmendment(emptyExecPolicy(), allow!);
  expect(evaluateExecPolicy("npm test src", store.amendments).matched?.kind).toBe("allow_prefix");
  const denied = upsertAmendment(store, {
    id: "d",
    kind: "deny_prefix",
    prefix: "npm publish",
    source: "operator",
    createdAt: new Date().toISOString(),
    refs: [],
  });
  expect(evaluateExecPolicy("npm publish", denied.amendments).allowed).toBe(false);
});
