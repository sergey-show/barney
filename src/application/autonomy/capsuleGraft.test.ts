import { expect, test } from "bun:test";
import { admitGraft, domainOverlap, graftProvenanceNote } from "./capsuleGraft.ts";
import type { ExternalCapsule } from "./capsuleGraft.ts";

const shellCapsule = (over: Partial<ExternalCapsule> = {}): ExternalCapsule => ({
  name: "shell-openssl-decrypt",
  klass: "shell openssl decrypt aes",
  procedure: ["shell openssl enc -d -aes-256-cbc -in secret.enc", "fs_write out/plain.txt"],
  sourceStatus: "frozen",
  sourceWins: 7,
  sourceTransfers: 2,
  sourceStrength: 0.95,
  sourceAgentId: "barney-other-001",
  ...over,
});

test("admitGraft accepts a well-formed capsule into quarantine", () => {
  const d = admitGraft({ capsule: shellCapsule(), targetTaskClass: "shell crypto openssl" });
  expect(d.admit).toBe(true);
  if (d.admit) {
    expect(d.record.status).toBe("quarantine");
    expect(d.record.bornFromMode).toBe("graft");
    expect(d.record.wins).toBe(0);
    expect(d.record.transfers).toBe(0);
    expect(d.record.fails).toBe(0);
    expect(d.record.strength).toBeLessThan(0.3);
    expect(d.record.bornFromClass).toBe("shell openssl decrypt aes");
  }
});

test("admitGraft drops source track record — wins/transfers reset to 0", () => {
  const d = admitGraft({ capsule: shellCapsule({ sourceWins: 99, sourceTransfers: 5 }), targetTaskClass: "shell openssl" });
  expect(d.admit).toBe(true);
  if (d.admit) {
    expect(d.record.wins).toBe(0);
    expect(d.record.transfers).toBe(0);
  }
});

test("admitGraft rejects empty name", () => {
  const d = admitGraft({ capsule: shellCapsule({ name: "" }), targetTaskClass: "shell openssl" });
  expect(d.admit).toBe(false);
  if (!d.admit) expect(d.reason).toContain("invalid name");
});

test("admitGraft rejects missing klass", () => {
  const d = admitGraft({ capsule: shellCapsule({ klass: "" }), targetTaskClass: "shell openssl" });
  expect(d.admit).toBe(false);
  if (!d.admit) expect(d.reason).toContain("missing klass");
});

test("admitGraft rejects empty procedure", () => {
  const d = admitGraft({ capsule: shellCapsule({ procedure: [] }), targetTaskClass: "shell openssl" });
  expect(d.admit).toBe(false);
  if (!d.admit) expect(d.reason).toContain("no procedure");
});

test("admitGraft lifts hardcoded paths into binding slots", () => {
  const d = admitGraft({
    capsule: shellCapsule({ procedure: ["shell cat /Users/bob/secret.txt", "fs_write /tmp/out.txt"] }),
    targetTaskClass: "shell openssl",
  });
  expect(d.admit).toBe(true);
  if (d.admit) {
    expect(d.bindingHits).toContain("abs_path");
    expect(d.record.procedure).toBeUndefined(); // procedure not carried on record — Kernel writes it
  }
});

test("admitGraft rejects bindings-only procedure (replay fails)", () => {
  // Every step is just binding slots after lift → replay rejects.
  const d = admitGraft({
    capsule: shellCapsule({ procedure: ["<binding> <binding> <binding>"] }),
    targetTaskClass: "shell openssl",
  });
  // liftBindings won't lift because no hardcoded patterns match <binding> literally;
  // but replayProcedure checks "bindings only" — tokens that are all <binding> or punctuation.
  // Here the step is already <binding> tokens → replay should fail.
  expect(d.admit).toBe(false);
  if (!d.admit) expect(d.reason).toContain("replay");
});

test("admitGraft rejects foreign-domain capsule (no token overlap)", () => {
  const d = admitGraft({
    capsule: shellCapsule({ klass: "python pandas dataframe merge" }),
    targetTaskClass: "shell openssl crypto",
  });
  expect(d.admit).toBe(false);
  if (!d.admit) expect(d.reason).toContain("domain mismatch");
});

test("admitGraft admits cross-domain when one token overlaps (e.g. shell)", () => {
  const d = admitGraft({
    capsule: shellCapsule({ klass: "shell tar extract archive" }),
    targetTaskClass: "shell openssl crypto",
  });
  expect(d.admit).toBe(true); // "shell" overlaps
});

test("admitGraft rejects oversized name (>128 chars)", () => {
  const d = admitGraft({
    capsule: shellCapsule({ name: "x".repeat(200) }),
    targetTaskClass: "shell openssl",
  });
  expect(d.admit).toBe(false);
});

test("domainOverlap is case-insensitive", () => {
  expect(domainOverlap("Shell OpenSSL", "shell openssl crypto")).toBe(true);
  expect(domainOverlap("PYTHON", "python pandas")).toBe(true);
});

test("domainOverlap ignores tokens shorter than 3 chars", () => {
  expect(domainOverlap("a b c", "a b c")).toBe(false);
  expect(domainOverlap("shell", "shell")).toBe(true);
});

test("graftProvenanceNote records source provenance and admit decision", () => {
  const cap = shellCapsule();
  const d = admitGraft({ capsule: cap, targetTaskClass: "shell openssl" });
  const note = graftProvenanceNote(cap, d);
  expect(note).toContain("graft: shell-openssl-decrypt");
  expect(note).toContain("sourceStatus: frozen");
  expect(note).toContain("sourceAgentId: barney-other-001");
  expect(note).toContain("admit: true");
});

test("graftProvenanceNote records reject reason on denial", () => {
  const cap = shellCapsule({ name: "" });
  const d = admitGraft({ capsule: cap, targetTaskClass: "shell openssl" });
  const note = graftProvenanceNote(cap, d);
  expect(note).toContain("admit: false");
  expect(note).toContain("rejectReason");
});
