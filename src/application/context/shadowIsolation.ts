/**
 * Shadow / recall isolation — enterprise trust without differential privacy.
 * Redact secret-like material before recall injection; scope bags away from raw secrets.
 */

const LIVE_SECRET_RE =
  /\b(?:AKIA[0-9A-Z]{8,}|ghp_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]{20,}|hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})\b/g;
const DETECTED_MASK_RE = /DETECTED_SECRET_[A-Z0-9]+_[A-F0-9]+/g;
const ENV_ASSIGN_RE =
  /\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|SLACK_BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*[^\s]+/gi;

export const SHADOW_REDACT = "<redacted-secret>";

/** True when a note must not enter cross-task Shadow recall. */
export function isRecallUnsafeNote(input: {
  key?: string;
  text: string;
  tags?: string[];
}): boolean {
  const tags = input.tags ?? [];
  if (tags.some((tag) => /secret|credential|password|private-key/i.test(tag))) return true;
  if (/^secret\//i.test(input.key ?? "")) return true;
  if (LIVE_SECRET_RE.test(input.text)) {
    LIVE_SECRET_RE.lastIndex = 0;
    return true;
  }
  LIVE_SECRET_RE.lastIndex = 0;
  return false;
}

/** Redact live secrets and vault masks for prompt injection. */
export function sanitizeRecallText(text: string): string {
  return text
    .replace(LIVE_SECRET_RE, SHADOW_REDACT)
    .replace(DETECTED_MASK_RE, SHADOW_REDACT)
    .replace(ENV_ASSIGN_RE, (line) => {
      const key = line.split("=")[0]?.trim() ?? "SECRET";
      return `${key}=${SHADOW_REDACT}`;
    });
}

export function filterNotesForShadowRecall<T extends { key?: string; text: string; tags?: string[] }>(
  items: T[],
): T[] {
  return items
    .filter((item) => !isRecallUnsafeNote(item))
    .map((item) => ({
      ...item,
      text: sanitizeRecallText(item.text),
    }));
}

/** Scope: keep Shadow lines that match the query family; drop unrelated long dumps. */
export function scopeShadowLines(lines: string[], query: string, limit = 4): string[] {
  const q = query.toLowerCase();
  const tokens = q
    .split(/[^\p{L}\p{N}:<>_-]+/u)
    .filter((token) => token.length > 2)
    .slice(0, 12);
  const scored = lines
    .map((line) => {
      const clean = sanitizeRecallText(line);
      const lower = clean.toLowerCase();
      const hits = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
      return { clean, hits };
    })
    .filter((row) => row.clean.trim().length > 0)
    .sort((a, b) => b.hits - a.hits);
  const matched = scored.filter((row) => row.hits > 0).slice(0, limit);
  if (matched.length) return matched.map((row) => row.clean);
  return scored.slice(0, Math.min(2, limit)).map((row) => row.clean);
}
