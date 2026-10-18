import { expect, test } from "bun:test";
import { groundingChipsFromTranscript } from "./groundingChips.ts";

test("groundingChipsFromTranscript reads latest oracle and PE", () => {
  const chips = groundingChipsFromTranscript([
    { kind: "system", text: "oracle: ok=0 · STRUCTURAL_MISS=1 · miss" },
    { kind: "system", text: "prediction_error: 1 · plan≠fact" },
    { kind: "assistant", text: "draft" },
  ]);
  expect(chips).toEqual([
    { kind: "oracle", ok: false, label: "oracle fail" },
    { kind: "pe", ok: false, label: "PE=1" },
  ]);
});
