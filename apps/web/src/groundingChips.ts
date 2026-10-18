/** Parse oracle / prediction_error system lines for chat chips. */

export type GroundingChip = {
  kind: "oracle" | "pe";
  ok: boolean;
  label: string;
};

export function groundingChipsFromTranscript(
  items: Array<{ kind: string; text: string }>,
): GroundingChip[] {
  const chips: GroundingChip[] = [];
  for (let i = items.length - 1; i >= 0 && chips.length < 4; i--) {
    const item = items[i]!;
    if (item.kind !== "system") continue;
    const text = item.text.trim();
    if (/^oracle:\s*/i.test(text) && !chips.some((c) => c.kind === "oracle")) {
      const ok = /ok=1\b/.test(text);
      chips.push({ kind: "oracle", ok, label: ok ? "oracle ok" : "oracle fail" });
    }
    if (/^prediction_error:\s*/i.test(text) && !chips.some((c) => c.kind === "pe")) {
      const err = /prediction_error:\s*1\b/.test(text);
      chips.push({ kind: "pe", ok: !err, label: err ? "PE=1" : "PE=0" });
    }
  }
  return chips.reverse();
}
