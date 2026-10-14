import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsProviderStore } from "../../infrastructure/spi/FsProviderStore.ts";
import { admitNewProvider } from "./providerStability.ts";
import { CompositeVerifyPort } from "./CompositeVerifyPort.ts";

test("exam runs shell verify and freezes on transfer success", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-spi-"));
  const worktree = mkdtempSync(join(tmpdir(), "barney-spi-wt-"));
  writeFileSync(join(worktree, "ok.txt"), "yes\n");
  const store = new FsProviderStore(join(home, "providers"));
  const manifest = admitNewProvider({
    name: "ok-check",
    port: "verify",
    invoke: { kind: "shell", command: "./verify.sh", timeoutSec: 15 },
  });
  store.save(manifest);
  const dir = store.dir("ok-check")!;
  const script = join(dir, "verify.sh");
  writeFileSync(script, "#!/bin/sh\ntest -f \"$BARNEY_SPI_WORKTREE/ok.txt\"\n");
  chmodSync(script, 0o755);

  const port = new CompositeVerifyPort(store);
  const result = await port.exam("ok-check", {
    worktree,
    goal: "ensure ok.txt exists",
  }, { transfer: true });
  expect(result.ok).toBe(true);
  expect(result.status).toBe("frozen");
  expect(store.get("ok-check")?.status).toBe("frozen");

  const active = await port.verify({ worktree, goal: "recheck" });
  expect(active).toHaveLength(1);
  expect(active[0]?.ok).toBe(true);
});

test("provider_write invent requires list — store itself stays body-only", () => {
  const home = mkdtempSync(join(tmpdir(), "barney-spi-store-"));
  const store = new FsProviderStore(join(home, "providers"));
  store.writeFile("demo", "verify.sh", "#!/bin/sh\nexit 0\n");
  expect(store.get("demo")?.status).toBe("quarantine");
  expect(store.list()).toHaveLength(1);
});
