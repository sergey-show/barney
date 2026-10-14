/**
 * Body SPI: providers implement kernel ports without patching src/.
 * Invocation is declarative (shell/mcp/skill) — no dynamic import of agent JS into the kernel.
 */

export const SPI_API_VERSION = 1;

/** Stable port ids the kernel understands. New ports = human release. */
export const SPI_PORTS = ["verify"] as const;
export type SpiPortId = (typeof SPI_PORTS)[number];

export type ProviderStatus = "quarantine" | "verified" | "frozen" | "deprecated" | "archived";

export type ProviderInvoke =
  | {
    kind: "shell";
    /** Relative to provider dir, e.g. verify.sh */
    command: string;
    timeoutSec?: number;
  }
  | {
    kind: "skill";
    /** Existing body skill/plugin name whose procedure is the check. */
    skill: string;
  };

export type ProviderManifest = {
  name: string;
  version: string;
  port: SpiPortId;
  apiVersion: number;
  status: ProviderStatus;
  description: string;
  invoke: ProviderInvoke;
  wins: number;
  transfers: number;
  fails: number;
  updatedAt: string;
  frozenAt?: string;
  /** Optional task-class hint for soft matching. */
  taskClass?: string;
};

export type VerifyRequest = {
  worktree: string;
  goal: string;
  evidence?: string;
  signal?: AbortSignal;
};

export type VerifyResult = {
  ok: boolean;
  detail: string;
  provider: string;
  status: ProviderStatus;
};

export function isSpiPortId(value: string): value is SpiPortId {
  return (SPI_PORTS as readonly string[]).includes(value);
}

export function providerDirName(name: string): string | null {
  const trimmed = name.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) return null;
  return trimmed;
}
