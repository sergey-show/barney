import type { DiscoverLedger } from "../context/capabilityDiscover.ts";
import { gateCapabilityWrite } from "../context/capabilityDiscover.ts";
import type { VerifyPort } from "../spi/CompositeVerifyPort.ts";
import { admitNewProvider, canRewriteProvider, parseProviderManifest } from "../spi/providerStability.ts";
import type { FsProviderStore } from "../../infrastructure/spi/FsProviderStore.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export async function runProviderTool(
  store: FsProviderStore,
  verify: VerifyPort,
  call: ToolCall,
  ctx: {
    worktree: string;
    goal: string;
    ledger: DiscoverLedger;
    evidence?: string;
  },
): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "");
  try {
    switch (call.name) {
      case "provider_list": {
        const listed = store.list();
        if (!listed.length) {
          return "No SPI providers. Prefer a skill/plugin first. provider_write only after provider_list (+ research for new).";
        }
        return listed
          .map((p) =>
            `- ${p.name} v${p.version} port=${p.port} status=${p.status} wins=${p.wins} transfers=${p.transfers}: ${p.description}`
          )
          .join("\n");
      }
      case "provider_read": {
        const name = str("name");
        const rel = str("path").trim() || "provider.json";
        return store.readAsset(name, rel);
      }
      case "provider_write": {
        const name = str("name");
        const path = str("path").trim() || "provider.json";
        const content = str("content");
        const exists = Boolean(store.get(name));
        const gate = gateCapabilityWrite({
          toolName: "provider_write",
          alreadyExists: exists,
          ledger: ctx.ledger,
        });
        if (gate.blocked) return `BLOCKED by Self: ${gate.reason}`;
        if (path === "provider.json") {
          const existing = store.get(name);
          if (existing && !canRewriteProvider(existing)) {
            return `BLOCKED: provider ${name} is ${existing.status} — cannot rewrite invoke/port`;
          }
          let manifest;
          try {
            manifest = parseProviderManifest(content, name);
          } catch {
            manifest = admitNewProvider({
              name,
              port: "verify",
              description: str("description") || `SPI verify provider ${name}`,
              invoke: { kind: "shell", command: "./verify.sh", timeoutSec: 30 },
            });
          }
          if (existing) {
            manifest = {
              ...manifest,
              status: existing.status,
              wins: existing.wins,
              transfers: existing.transfers,
              fails: existing.fails,
              frozenAt: existing.frozenAt,
            };
          }
          store.save(manifest);
          return `saved provider:${manifest.name} status=${manifest.status} port=${manifest.port} (quarantine until provider_exam)`;
        }
        const saved = store.writeFile(name, path, content);
        return `saved provider:${saved.name} ${path} status=${saved.status}`;
      }
      case "provider_exam": {
        const name = str("name");
        const transfer = /^(1|true|yes)$/i.test(str("transfer"));
        const result = await verify.exam(name, {
          worktree: ctx.worktree,
          goal: ctx.goal,
          evidence: ctx.evidence,
        }, { transfer });
        return [
          `spi_exam: provider=${result.provider}`,
          `ok=${result.ok ? 1 : 0}`,
          `status=${result.status}`,
          `detail=${result.detail}`,
        ].join(" · ");
      }
      case "provider_verify": {
        const results = await verify.verify({
          worktree: ctx.worktree,
          goal: ctx.goal,
          evidence: ctx.evidence,
        });
        if (!results.length) return "spi_verify: no active (verified|frozen) providers";
        return results
          .map((r) => `spi_verify: ${r.provider} ok=${r.ok ? 1 : 0} status=${r.status} · ${r.detail}`)
          .join("\n");
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
