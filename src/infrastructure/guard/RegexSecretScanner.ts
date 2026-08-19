import { DomainError } from "../../domain/shared/DomainError.ts";
import { GuardPolicy } from "../../domain/guard/GuardPolicy.ts";
import { MaskedText, type SecretHit } from "../../domain/guard/MaskedText.ts";
import {
  detectedSecretToken,
  isDetectedSecretToken,
  looksLikeUserPlaceholder,
} from "../../domain/guard/secretPlaceholder.ts";
import type { SecretVault } from "../../application/ports.ts";

/** Identifier names a secret binding (env, header, field) — not a vendor prefix. */
const CREDENTIAL_NAME =
  /password|passwd|secret|token|authorization|credential|api[_-]?key|(?:access|private|secret)[_-]?key/i;

/** JSON object header (`{"`) in base64url — the JWT shape, not a vendor. */
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const PUBLIC_PEM = /-----BEGIN (CERTIFICATE|PUBLIC KEY|RSA PUBLIC KEY)-----[\s\S]+?-----END \1-----/g;
const URI_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+):([^/\s@]+)@/gi;
const ASSIGNMENT = /([A-Za-z_][A-Za-z0-9_.-]*)[^A-Za-z0-9_.-=:]{0,8}[:=][ \t]*['"]?([^\s'"]{8,})/g;
const OPAQUE = /\b[A-Za-z0-9_\-+]{24,}\b/g;

export class RegexSecretScanner {
  constructor(
    private readonly policy: GuardPolicy,
    private readonly vault: SecretVault,
  ) {}

  scan(text: string, path?: string): MaskedText {
    if (path && this.policy.isDeniedPath(path)) {
      if (this.policy.onDetect === "block") {
        throw new DomainError("guard_block", `refusing to load denied path ${path}`);
      }
      const placeholder = detectedSecretToken("denied_path", "file");
      return new MaskedText(placeholder, [{ kind: "denied_path", placeholder }]);
    }

    const hits: SecretHit[] = [];
    let masked = text;
    masked = masked.replace(PEM, (raw) => this.replaceValue(raw, raw, "pem", hits));
    masked = masked.replace(URI_USERINFO, (raw, scheme: string, user: string, pass: string) => {
      const userinfo = `${user}:${pass}`;
      return `${scheme}${this.replaceValue(raw, userinfo, "uri_secret", hits)}@`;
    });
    masked = masked.replace(JWT, (raw) => this.replaceValue(raw, raw, "jwt", hits));
    masked = masked.replace(ASSIGNMENT, (raw, name: string, value: string) => {
      if (!CREDENTIAL_NAME.test(name) || looksLikePublicValue(value)) return raw;
      const token = this.replaceValue(raw, value, "credential", hits);
      return token === raw ? raw : raw.replace(value, token);
    });
    const publicHoles: string[] = [];
    masked = masked.replace(PUBLIC_PEM, (raw) => {
      publicHoles.push(raw);
      return `\0PUBLIC_PEM_${publicHoles.length - 1}\0`;
    });
    masked = masked.replace(OPAQUE, (raw) => {
      if (shannon(raw) < this.policy.entropyThreshold) return raw;
      return this.replaceValue(raw, raw, "high_entropy", hits);
    });
    masked = masked.replace(/\0PUBLIC_PEM_(\d+)\0/g, (_, index: string) => publicHoles[Number(index)] ?? "");
    return new MaskedText(masked, hits);
  }

  private replaceValue(raw: string, value: string, kind: string, hits: SecretHit[]): string {
    if (shouldLeave(value, this.policy)) return raw.includes(value) && value !== raw ? value : raw;
    if (this.policy.onDetect === "block") {
      throw new DomainError("guard_block", `blocked ${kind}`);
    }
    const placeholder = detectedSecretToken(kind, shortHash(value));
    this.vault.store(placeholder, value);
    hits.push({ kind, placeholder });
    return placeholder;
  }
}

function looksLikePublicValue(value: string): boolean {
  if (/^https?:\/\//i.test(value) && !value.includes("@")) return true;
  if (/^[0-9.]+$/.test(value)) return true;
  if (/^(true|false|null|none|yes|no)$/i.test(value)) return true;
  return false;
}

function shouldLeave(value: string, policy: GuardPolicy): boolean {
  if (policy.isAllowed(value)) return true;
  if (isDetectedSecretToken(value) || value.includes("DETECTED_SECRET_")) return true;
  if (looksLikeUserPlaceholder(value)) return true;
  return false;
}

function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function shannon(value: string): number {
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let e = 0;
  for (const c of freq.values()) {
    const p = c / value.length;
    e -= p * Math.log2(p);
  }
  return e;
}
