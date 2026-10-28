import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeWorkspace } from "./NodeWorkspace.ts";

test("grep / glob / patch work on NodeWorkspace", async () => {
  const root = join(tmpdir(), `barney-ggp-${Date.now()}`);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const alpha = 1;\n");
  writeFileSync(join(root, "src", "b.ts"), "export const beta = 2;\n");
  const ws = new NodeWorkspace(root, (t) => t);

  const grepped = await ws.grep("alpha", ".", "*.ts");
  expect(grepped).toMatch(/a\.ts/);

  const globbed = await ws.glob("**/*.ts");
  expect(globbed).toMatch(/a\.ts/);
  expect(globbed).toMatch(/b\.ts/);

  const patched = await ws.patch(`--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-export const alpha = 1;
+export const alpha = 42;
`);
  expect(patched).toMatch(/updated/);
  expect(await ws.read("src/a.ts")).toContain("42");

  rmSync(root, { recursive: true, force: true });
});
