/**
 * Provider body stability — same spirit as skill quarantine→verified→frozen.
 * Frozen providers are not rewritten by agent invent.
 */

import type { ProviderManifest, ProviderStatus } from "./providerTypes.ts";
import { SPI_API_VERSION, isSpiPortId, providerDirName } from "./providerTypes.ts";

export function admitNewProvider(input: {
  name: string;
  port: string;
  description?: string;
  invoke: ProviderManifest["invoke"];
  version?: string;
  taskClass?: string;
}): ProviderManifest {
  const name = providerDirName(input.name);
  if (!name) throw new Error("provider name must be kebab-case");
  if (!isSpiPortId(input.port)) throw new Error(`unknown SPI port: ${input.port}`);
  const now = new Date().toISOString();
  return {
    name,
    version: input.version?.trim() || "1",
    port: input.port,
    apiVersion: SPI_API_VERSION,
    status: "quarantine",
    description: input.description?.trim() || `SPI provider for ${input.port}`,
    invoke: input.invoke,
    wins: 0,
    transfers: 0,
    fails: 0,
    updatedAt: now,
    taskClass: input.taskClass?.trim() || undefined,
  };
}

export function parseProviderManifest(raw: string, fallbackName: string): ProviderManifest {
  const parsed = JSON.parse(raw) as Partial<ProviderManifest>;
  const name = providerDirName(parsed.name ?? fallbackName);
  if (!name) throw new Error("invalid provider name");
  if (!isSpiPortId(String(parsed.port ?? ""))) throw new Error(`unknown SPI port: ${parsed.port}`);
  if (!parsed.invoke || typeof parsed.invoke !== "object") throw new Error("invoke is required");
  const base = admitNewProvider({
    name,
    port: String(parsed.port),
    description: parsed.description,
    invoke: parsed.invoke as ProviderManifest["invoke"],
    version: parsed.version,
    taskClass: parsed.taskClass,
  });
  return {
    ...base,
    status: normalizeStatus(parsed.status) ?? "quarantine",
    wins: Math.max(0, Number(parsed.wins ?? 0)),
    transfers: Math.max(0, Number(parsed.transfers ?? 0)),
    fails: Math.max(0, Number(parsed.fails ?? 0)),
    updatedAt: parsed.updatedAt ?? base.updatedAt,
    frozenAt: parsed.frozenAt,
    apiVersion: Number(parsed.apiVersion ?? SPI_API_VERSION),
  };
}

export function formatProviderManifest(manifest: ProviderManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function providerEligibleForRun(manifest: ProviderManifest): boolean {
  if (manifest.apiVersion !== SPI_API_VERSION) return false;
  return manifest.status === "verified" || manifest.status === "frozen";
}

export function canRewriteProvider(manifest: ProviderManifest | null | undefined): boolean {
  if (!manifest) return true;
  if (manifest.status === "frozen" || manifest.status === "archived" || manifest.status === "deprecated") {
    return false;
  }
  return manifest.status === "quarantine" && manifest.wins === 0 && manifest.transfers === 0;
}

export function graduateProviderStatus(manifest: ProviderManifest): ProviderManifest {
  const next = { ...manifest };
  if (next.status === "quarantine" && (next.wins >= 2 || next.transfers >= 1)) {
    next.status = "verified";
  }
  if (next.status === "verified" && (next.wins >= 3 || next.transfers >= 1)) {
    next.status = "frozen";
    next.frozenAt = next.updatedAt;
  }
  return next;
}

export function recordProviderOutcome(
  manifest: ProviderManifest,
  input: { success: boolean; transfer?: boolean },
): ProviderManifest {
  const now = new Date().toISOString();
  if (!input.success) {
    return {
      ...manifest,
      fails: manifest.fails + 1,
      updatedAt: now,
    };
  }
  return graduateProviderStatus({
    ...manifest,
    wins: manifest.wins + 1,
    transfers: manifest.transfers + (input.transfer ? 1 : 0),
    updatedAt: now,
  });
}

function normalizeStatus(value: unknown): ProviderStatus | null {
  if (
    value === "quarantine"
    || value === "verified"
    || value === "frozen"
    || value === "deprecated"
    || value === "archived"
  ) {
    return value;
  }
  return null;
}
