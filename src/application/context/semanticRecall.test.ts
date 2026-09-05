import { expect, test } from "bun:test";
import { cosine, formatShadowWarnings, rankByEmbeddings, rankBySimilarity } from "./semanticRecall.ts";

test("rankBySimilarity prefers overlapping fail notes", () => {
  const ranked = rankBySimilarity("openssl cert timeout", [
    { key: "a", text: "openssl genrsa timed out — use python", tags: ["fail"] },
    { key: "b", text: "nginx config missing listen directive", tags: ["fail"] },
    { key: "c", text: "unrelated grocery list", tags: ["note"] },
  ], 2);
  expect(ranked[0]?.key).toBe("a");
  expect(ranked.map((item) => item.key)).not.toContain("c");
});

test("rankByEmbeddings uses cosine proximity", () => {
  const ranked = rankByEmbeddings([1, 0, 0], [
    { key: "near", text: "near", vector: [0.9, 0.1, 0] },
    { key: "far", text: "far", vector: [0, 1, 0] },
  ], 1);
  expect(ranked[0]?.key).toBe("near");
  expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
});

test("formatShadowWarnings is empty without hits", () => {
  expect(formatShadowWarnings([])).toBe("");
  expect(formatShadowWarnings([{ key: "x", text: "do not repeat openssl" }])).toContain("Shadow warnings");
});
