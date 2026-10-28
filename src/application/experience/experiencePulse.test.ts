import { expect, test } from "bun:test";
import { pulseFromEpisodes } from "./experiencePulse.ts";

test("pulseFromEpisodes computes hit/used/pe rates", () => {
  const pulse = pulseFromEpisodes(
    [
      { markers: ["recall_hit:1", "recall_used:1", "pe:1"] },
      { markers: ["recall_hit:1", "recall_used:0", "pe:0"] },
      { markers: ["recall_hit:0", "recall_used:0", "pe:1"] },
    ],
    { transfer: 2, memorize: 1, inClass: 0, freshSuccess: 3, freshFail: 1, updatedAt: "" },
  );
  expect(pulse.hitRate).toBeCloseTo(2 / 3);
  expect(pulse.usedRate).toBeCloseTo(1 / 3);
  expect(pulse.peRate).toBeCloseTo(2 / 3);
  expect(pulse.transfer).toBe(2);
  expect(pulse.line).toContain("experience_pulse:");
  expect(pulse.line).toContain("transfer=2");
});
