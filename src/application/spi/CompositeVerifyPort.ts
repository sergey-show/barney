import type { FsProviderStore } from "../../infrastructure/spi/FsProviderStore.ts";
import { runShellVerify } from "../../infrastructure/spi/ShellVerifyAdapter.ts";
import { providerEligibleForRun, recordProviderOutcome } from "./providerStability.ts";
import type { ProviderManifest, VerifyRequest, VerifyResult } from "./providerTypes.ts";

export type VerifyPort = {
  /** Active (verified|frozen) providers only. */
  verify(req: VerifyRequest): Promise<VerifyResult[]>;
  /** Exam path: may run quarantine; persists graduation on success. */
  exam(name: string, req: VerifyRequest, opts?: { transfer?: boolean }): Promise<VerifyResult>;
  list(): ProviderManifest[];
};

/**
 * Kernel-side VerifyPort: discovers body providers, never loads agent JS into-process.
 */
export class CompositeVerifyPort implements VerifyPort {
  constructor(private readonly store: FsProviderStore) {}

  list(): ProviderManifest[] {
    return this.store.list();
  }

  async verify(req: VerifyRequest): Promise<VerifyResult[]> {
    const active = this.store.list().filter((p) => p.port === "verify" && providerEligibleForRun(p));
    const results: VerifyResult[] = [];
    for (const manifest of active) {
      results.push(await this.invoke(manifest, req));
    }
    return results;
  }

  async exam(
    name: string,
    req: VerifyRequest,
    opts?: { transfer?: boolean },
  ): Promise<VerifyResult> {
    const manifest = this.store.get(name);
    if (!manifest) {
      return { ok: false, detail: "provider not found", provider: name, status: "quarantine" };
    }
    if (manifest.port !== "verify") {
      return {
        ok: false,
        detail: `port ${manifest.port} is not verify`,
        provider: manifest.name,
        status: manifest.status,
      };
    }
    const result = await this.invoke(manifest, req);
    const next = recordProviderOutcome(manifest, {
      success: result.ok,
      transfer: Boolean(opts?.transfer),
    });
    this.store.save(next);
    return { ...result, status: next.status };
  }

  private async invoke(manifest: ProviderManifest, req: VerifyRequest): Promise<VerifyResult> {
    const dir = this.store.dir(manifest.name);
    if (!dir) {
      return {
        ok: false,
        detail: "invalid provider dir",
        provider: manifest.name,
        status: manifest.status,
      };
    }
    if (manifest.invoke.kind === "shell") {
      return runShellVerify(dir, manifest, req);
    }
    if (manifest.invoke.kind === "skill") {
      return {
        ok: false,
        detail: `skill invoke (${manifest.invoke.skill}) is reserved — use shell verify.sh for SPI v1`,
        provider: manifest.name,
        status: manifest.status,
      };
    }
    return {
      ok: false,
      detail: "unsupported invoke",
      provider: manifest.name,
      status: manifest.status,
    };
  }
}
