import { expect, test } from "bun:test";
import { canSoftZpd, chooseZpdDepth } from "./zpdDepth.ts";

test("soft-* failClass always selects soft", () => {
  expect(chooseZpdDepth({ failClass: "soft-complaint-evasion", goal: "anything" })).toBe("soft");
});

test("multi-step goal forces full even for simple-looking tasks", () => {
  expect(
    chooseZpdDepth({
      failClass: "general",
      goal: "multi-step pipeline rollout with canary",
      procedure: ["a", "b"],
    }),
  ).toBe("full");
});

test("procedure length >= 3 forces full", () => {
  expect(
    chooseZpdDepth({
      failClass: "general",
      goal: "redact tokens",
      procedure: ["a", "b", "c"],
    }),
  ).toBe("full");
});

test("house-convention goal with oracle selects soft", () => {
  expect(
    chooseZpdDepth({
      failClass: "general",
      goal: "replace live secrets with house redaction tokens",
      procedure: ["replace tokens", "write audit"],
      hasOracle: true,
    }),
  ).toBe("soft");
});

test("house-convention goal without oracle falls back to full", () => {
  expect(
    chooseZpdDepth({
      failClass: "general",
      goal: "replace live secrets with house redaction tokens",
      hasOracle: false,
    }),
  ).toBe("full");
});

test("explicit expectations matrix + oracle selects soft", () => {
  expect(
    chooseZpdDepth({
      failClass: "general",
      goal: "produce a compliance report",
      hasExpectationsMatrix: true,
      hasOracle: true,
    }),
  ).toBe("soft");
});

test("expectations matrix without oracle stays full", () => {
  expect(
    chooseZpdDepth({
      failClass: "general",
      goal: "produce a compliance report",
      hasExpectationsMatrix: true,
      hasOracle: false,
    }),
  ).toBe("full");
});

test("SPI provider signal forces full", () => {
  expect(
    chooseZpdDepth({
      failClass: "general",
      goal: "call the spi-provider for credentials",
      procedure: ["a"],
    }),
  ).toBe("full");
});

test("conservative default is full", () => {
  expect(chooseZpdDepth({ failClass: "general", goal: "do something" })).toBe("full");
});

test("canSoftZpd true for soft failClass", () => {
  expect(canSoftZpd({ failClass: "soft-x", hasOracle: false })).toBe(true);
});

test("canSoftZpd true for matrix+oracle", () => {
  expect(canSoftZpd({ failClass: "general", hasExpectationsMatrix: true, hasOracle: true })).toBe(true);
});

test("canSoftZpd false without oracle or matrix", () => {
  expect(canSoftZpd({ failClass: "general", hasOracle: true })).toBe(false);
});
