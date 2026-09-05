import { expect, test } from "bun:test";
import { classifyTask, compareProgress, measureProgress } from "./progressSignal.ts";

test("delivery progress rises with mutates and falls with missing files", () => {
  const empty = measureProgress({
    latest: "Write `/work/out.txt` and sanitize secrets",
    evidence: "",
    missingArtifacts: ["/work/out.txt"],
  });
  expect(empty.taskKind).toBe("delivery");
  expect(empty.score).toBeLessThan(40);

  const written = measureProgress({
    latest: "Write `/work/out.txt`",
    evidence: 'fs_write {"path":"/work/out.txt","content":"ok"}\nwrote /work/out.txt',
    missingArtifacts: [],
    prev: empty,
  });
  expect(written.delta).toBe("improved");
  expect(written.secondWind).toBe(true);
  expect(written.score).toBeGreaterThan(empty.score);
});

test("second wind when newSignal even if score flat", () => {
  const a = measureProgress({
    latest: "research the API",
    evidence: 'shell {"command":"grep x"}\nexit 0',
  });
  const b = measureProgress({
    latest: "research the API",
    evidence: a.pinLine,
    prev: a,
    newSignal: true,
  });
  expect(b.secondWind).toBe(true);
});

test("compareProgress detects regression on more missing", () => {
  expect(compareProgress(
    { score: 50, missingArtifacts: 0, mutates: 1, probes: 0 } as never,
    { score: 40, missingArtifacts: 2, mutates: 1, probes: 0 },
  )).toBe("regressed");
});

test("classifyTask separates research from delivery", () => {
  expect(classifyTask("look up the docs for openssl")).toBe("research");
  expect(classifyTask("fix nginx.conf log format")).toBe("delivery");
});
