import { DomainError } from "../../domain/shared/DomainError.ts";
import { GuardPolicy } from "../../domain/guard/GuardPolicy.ts";
import { MaskedText, type SecretHit } from "../../domain/guard/MaskedText.ts";
import type { SecretVault } from "../../application/ports.ts";

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
  { kind: "github_pat", re: /ghp_[A-Za-z0-9_]{20,}/g },
  { kind: "github_fine", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { kind: "slack", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "openai", re: /sk-(?:live|proj|svcacct)?[-_A-Za-z0-9]{20,}/g },
  { kind: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { kind: "pem", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: "connection", re: /(?:postgres|mysql|mongodb|redis):\/\/[^\s]+:[^\s]+@[^\s]+/gi },
  { kind: "assignment", re: /(?:password|passwd|secret|api[_-]?key|token|authorization)\s*[:=]\s*['\"]?([^\s'\"]{8,})/gi },
];

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
      return new MaskedText(`{{SECRET:denied_path:file}}`, [{ kind: "denied_path", placeholder: "{{SECRET:denied_path:file}}" }]);
    }

    let masked = text;
    const hits: SecretHit[] = [];

    for (const { kind, re } of PATTERNS) {
      masked = masked.replace(re, (raw, group: string | number) => {
        const value = typeof group === "string" && raw.includes(group) ? group : raw;
        if (this.policy.isAllowed(value)) return raw;
        if (this.policy.onDetect === "block") {
          throw new DomainError("guard_block", `blocked ${kind}`);
        }
        const placeholder = `{{SECRET:${kind}:${shortHash(value)}}}`;
        this.vault.store(placeholder, value);
        hits.push({ kind, placeholder });
        return raw.includes(value) && value !== raw ? raw.replace(value, placeholder) : placeholder;
      });
    }

    masked = maskHighEntropy(masked, this.policy.entropyThreshold, this.vault, hits, this.policy);
    return new MaskedText(masked, hits);
  }
}

function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h.toString(16).slice(0, 3);
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

function maskHighEntropy(
  text: string,
  threshold: number,
  vault: SecretVault,
  hits: SecretHit[],
  policy: GuardPolicy,
): string {
  return text.replace(/\b[A-Za-z0-9_\-+/=]{24,}\b/g, (token) => {
    if (policy.isAllowed(token)) return token;
    if (token.startsWith("{{SECRET:")) return token;
    if (shannon(token) < threshold) return token;
    const placeholder = `{{SECRET:entropy:${shortHash(token)}}}`;
    vault.store(placeholder, token);
    hits.push({ kind: "entropy", placeholder });
    return placeholder;
  });
}
