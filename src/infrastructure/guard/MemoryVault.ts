import type { SecretVault } from "../../application/ports.ts";

export class MemoryVault implements SecretVault {
  private readonly values = new Map<string, string>();

  store(placeholder: string, value: string): void {
    this.values.set(placeholder, value);
  }

  resolve(placeholder: string): string | undefined {
    return this.values.get(placeholder);
  }
}
