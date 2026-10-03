import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  admitNewProvider,
  canRewriteProvider,
  formatProviderManifest,
  parseProviderManifest,
} from "../../application/spi/providerStability.ts";
import type { ProviderManifest } from "../../application/spi/providerTypes.ts";
import { providerDirName } from "../../application/spi/providerTypes.ts";

/**
 * Body store for SPI providers: ~/.barney/providers/<name>/provider.json
 */
export class FsProviderStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  list(): ProviderManifest[] {
    if (!existsSync(this.root)) return [];
    const out: ProviderManifest[] = [];
    for (const name of readdirSync(this.root)) {
      const manifest = this.get(name);
      if (manifest) out.push(manifest);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): ProviderManifest | null {
    const dir = providerDirName(name);
    if (!dir) return null;
    const path = join(this.root, dir, "provider.json");
    if (!existsSync(path)) return null;
    try {
      return parseProviderManifest(readFileSync(path, "utf8"), dir);
    } catch {
      return null;
    }
  }

  dir(name: string): string | null {
    const dir = providerDirName(name);
    if (!dir) return null;
    return join(this.root, dir);
  }

  save(manifest: ProviderManifest): ProviderManifest {
    const dir = providerDirName(manifest.name);
    if (!dir) throw new Error("invalid provider name");
    const existing = this.get(dir);
    if (!canRewriteProvider(existing) && existing) {
      // Allow status/wins updates from registry exams; block port/invoke rewrite when frozen.
      if (
        existing.port !== manifest.port
        || JSON.stringify(existing.invoke) !== JSON.stringify(manifest.invoke)
      ) {
        throw new Error(`provider ${dir} is ${existing.status} — invoke/port frozen`);
      }
    }
    const folder = join(this.root, dir);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "provider.json"), formatProviderManifest(manifest), "utf8");
    return manifest;
  }

  writeFile(name: string, rel: string, content: string): ProviderManifest {
    const dir = providerDirName(name);
    if (!dir) throw new Error("provider name must be kebab-case");
    if (!rel || rel.includes("..") || rel.startsWith("/") || rel.startsWith("\\")) {
      throw new Error("path escapes provider directory");
    }
    const existing = this.get(dir);
    if (rel === "provider.json") {
      const next = parseProviderManifest(content, dir);
      return this.save(next);
    }
    if (existing && !canRewriteProvider(existing) && existing.status === "frozen") {
      throw new Error(`provider ${dir} is frozen — file writes blocked`);
    }
    const folder = join(this.root, dir);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, rel), content, "utf8");
    if (!existing) {
      return this.save(admitNewProvider({
        name: dir,
        port: "verify",
        description: `SPI provider ${dir}`,
        invoke: { kind: "shell", command: "./verify.sh", timeoutSec: 30 },
      }));
    }
    return existing;
  }

  readAsset(name: string, rel: string): string {
    const folder = this.dir(name);
    if (!folder) throw new Error("invalid provider name");
    if (!rel || rel.includes("..") || rel.startsWith("/") || rel.startsWith("\\")) {
      throw new Error("path escapes provider directory");
    }
    const full = join(folder, rel);
    if (!existsSync(full)) throw new Error(`file not found: ${rel}`);
    return readFileSync(full, "utf8");
  }
}
