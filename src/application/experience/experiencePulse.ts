/**
 * Idle / psyche pulse from episode recall markers + transfer ledger.
 * Surfaces experience closure without re-running four-hand.
 */

import type { TransferStats } from "../context/transferLedger.ts";

export type ExperiencePulse = {
  episodeCount: number;
  hitRate: number | null;
  usedRate: number | null;
  peRate: number | null;
  transfer: number;
  memorize: number;
  freshSuccess: number;
  freshFail: number;
  line: string;
};

export function pulseFromEpisodes(
  episodes: Array<{ markers?: string[] }>,
  transfer?: TransferStats | null,
): ExperiencePulse {
  let hitN = 0;
  let hitOk = 0;
  let usedN = 0;
  let usedOk = 0;
  let peN = 0;
  let peOk = 0;
  for (const episode of episodes) {
    const markers = episode.markers ?? [];
    const hit = markers.find((m) => m.startsWith("recall_hit:"));
    if (hit) {
      hitN += 1;
      if (hit.endsWith(":1")) hitOk += 1;
    }
    const used = markers.find((m) => m.startsWith("recall_used:"));
    if (used) {
      usedN += 1;
      if (used.endsWith(":1")) usedOk += 1;
    }
    const pe = markers.find((m) => m.startsWith("pe:"));
    if (pe) {
      peN += 1;
      if (pe.endsWith(":1")) peOk += 1;
    }
  }
  const hitRate = hitN ? hitOk / hitN : null;
  const usedRate = usedN ? usedOk / usedN : null;
  const peRate = peN ? peOk / peN : null;
  const t = transfer ?? { transfer: 0, memorize: 0, freshSuccess: 0, freshFail: 0 };
  const fmt = (n: number | null) => (n == null ? "?" : n.toFixed(2));
  const line = [
    `experience_pulse: hit=${fmt(hitRate)} used=${fmt(usedRate)} pe=${fmt(peRate)}`,
    `transfer=${t.transfer} memorize=${t.memorize} fresh=${t.freshSuccess}/${t.freshFail}`,
    `n=${episodes.length}`,
  ].join(" · ");
  return {
    episodeCount: episodes.length,
    hitRate,
    usedRate,
    peRate,
    transfer: t.transfer,
    memorize: t.memorize,
    freshSuccess: t.freshSuccess,
    freshFail: t.freshFail,
    line,
  };
}
