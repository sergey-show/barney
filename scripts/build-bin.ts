import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
mkdirSync(join(root, "dist"), { recursive: true });

const vite = Bun.spawnSync(["bunx", "vite", "build", "--config", "apps/web/vite.config.ts"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (vite.exitCode !== 0) process.exit(vite.exitCode ?? 1);

const web = join(root, "apps/web/dist");
if (!existsSync(join(web, "index.html"))) {
  console.error("web build missing index.html");
  process.exit(1);
}

const TARGETS: Record<string, { bun: string; file: string }> = {
  native: { bun: "", file: join(root, "dist/barney") },
  "darwin-arm64": { bun: "bun-darwin-arm64", file: join(root, "dist/barney-darwin-arm64") },
  "darwin-x64": { bun: "bun-darwin-x64", file: join(root, "dist/barney-darwin-x64") },
  "linux-x64": { bun: "bun-linux-x64", file: join(root, "dist/barney-linux-x64") },
  "linux-arm64": { bun: "bun-linux-arm64", file: join(root, "dist/barney-linux-arm64") },
  "windows-x64": { bun: "bun-windows-x64", file: join(root, "dist/barney-windows-x64.exe") },
};

const requested = (process.argv[2] ?? "native").trim();
const names = requested === "all" ? Object.keys(TARGETS).filter((name) => name !== "native") : [requested];

for (const name of names) {
  const spec = TARGETS[name];
  if (!spec) {
    console.error(`unknown target ${name}. Use native | all | ${Object.keys(TARGETS).join(" | ")}`);
    process.exit(1);
  }
  const args = [
    "bun",
    "build",
    "--compile",
    "--external=playwright",
    "--external=playwright-core",
    "--external=chromium-bidi",
    "--asset=./apps/web/dist",
    join(root, "src/presentation/cli/main.ts"),
    `--outfile=${spec.file}`,
  ];
  if (spec.bun) args.splice(3, 0, `--target=${spec.bun}`);
  const compiled = Bun.spawnSync(args, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (compiled.exitCode !== 0) process.exit(compiled.exitCode ?? 1);
  console.log(`wrote ${spec.file}`);
}
