import type { SecretVault } from "../../application/ports.ts";

export class MemoryVault implements SecretVault {
  private readonly values = new Map<string, string>();

  store(placeholder: string, value: string): void {
    this.values.set(placeholder, value);
  }

  resolve(placeholder: string): string | undefined {
    return this.values.get(placeholder);
  }

  reveal(text: string): string {
    if (!text || this.values.size === 0) return text;
    const tokens = [...this.values.entries()].sort((a, b) => b[0].length - a[0].length);
    let out = text;
    for (const [placeholder, value] of tokens) {
      if (out.includes(placeholder)) out = out.split(placeholder).join(value);
    }
    return out;
  }
}
