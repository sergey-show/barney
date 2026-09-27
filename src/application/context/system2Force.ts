/**
 * System-2 escalation — metacognitive control over short/fast path.
 * Shadow hits + frustration force deeper strategies (not forever reflection).
 */

import type { StrategyName } from "../../domain/run/Strategy.ts";

export function shouldForceSystem2(input: {
  shadowHits: number;
  frustration: number;
  shortProposed?: boolean;
}): boolean {
  if (input.shadowHits >= 2) return true;
  if (input.shadowHits >= 1 && input.frustration >= 2) return true;
  if (input.frustration >= 4) return true;
  return false;
}

/** Prefer deeper strategies when forced. */
export function system2PreferStrategies(input: {
  shadowHits: number;
  frustration: number;
}): StrategyName[] {
  if (!shouldForceSystem2(input)) return [];
  if (input.shadowHits >= 1) return ["recall_failures", "decompose", "research"];
  return ["decompose", "research"];
}

export function formatSystem2ForceLine(input: {
  shadowHits: number;
  frustration: number;
}): string {
  return `system2_force: shadow=${input.shadowHits} frustration=${input.frustration} · prefer decompose/research`;
}
