export const DETECTED_SECRET_PREFIX = "DETECTED_SECRET_";

export function detectedSecretToken(kind: string, hash: string): string {
  const label = kind.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() || "SECRET";
  return `${DETECTED_SECRET_PREFIX}${label}_${hash.toUpperCase()}`;
}

export function isDetectedSecretToken(value: string): boolean {
  return /^DETECTED_SECRET_[A-Z0-9_]+$/.test(value) || value.startsWith("{{SECRET:");
}

export function looksLikeUserPlaceholder(value: string): boolean {
  return /^<your-[a-z0-9-]+>$/i.test(value.trim());
}
