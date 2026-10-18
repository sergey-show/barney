/**
 * Soft-repair nudge fragments for persistUntilDone (extracted from DriveSolve).
 * Keeps oracle evidence visible to the next act without growing the use-case file.
 */

import type { Review } from "../../domain/run/Review.ts";

export function oraclePersistHint(evidenceLine: string | null | undefined): string {
  if (!evidenceLine?.trim()) return "";
  return `\nOracle fact (must satisfy before claiming done):\n${evidenceLine.trim()}\n`;
}

export function softReviewMissing(review: Review): string {
  return review.missing || review.summary || "soft matrix not satisfied";
}
