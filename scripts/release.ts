/**
 * Publish @encsch/barney to npm and attach compiled binaries to a GitHub release.
 *
 *   bun run release              # use package.json version if untagged, else bump patch
 *   bun run release -- --bump minor
 *   bun run release -- --version 0.2.0
 *   bun run release -- --dry-run
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkgPath = join(root, "package.json");

type Args = {
  bump: "patch" | "minor" | "major" | undefined;
  version: string | undefined;
  dryRun: boolean;
  skipNpm: boolean;
  skipGh: boolean;
  skipBin: boolean;
  allowDirty: boolean;
  title: string | undefined;
  notes: string | undefined;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    bump: undefined,
    version: undefined,
    dryRun: false,
    skipNpm: false,
    skipGh: false,
    skipBin: false,
    allowDirty: false,
    title: undefined,
    notes: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--skip-npm") args.skipNpm = true;
    else if (arg === "--skip-gh") args.skipGh = true;
    else if (arg === "--skip-bin") args.skipBin = true;
    else if (arg === "--allow-dirty") args.allowDirty = true;
    else if (arg === "--bump") {
      const kind = argv[++i];
      if (kind !== "patch" && kind !== "minor" && kind !== "major") fail("use --bump patch|minor|major");
      args.bump = kind;
    } else if (arg.startsWith("--bump=")) {
      const kind = arg.slice(7);
      if (kind !== "patch" && kind !== "minor" && kind !== "major") fail("use --bump patch|minor|major");
      args.bump = kind;
    } else if (arg === "--version") {
      args.version = argv[++i];
    } else if (arg.startsWith("--version=")) {
      args.version = arg.slice(10);
    } else if (arg === "--title") {
      args.title = argv[++i];
    } else if (arg.startsWith("--title=")) {
      args.title = arg.slice(8);
    } else if (arg === "--notes") {
      args.notes = argv[++i];
    } else if (arg.startsWith("--notes=")) {
      args.notes = arg.slice(8);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: bun run scripts/release.ts [options]
  --bump patch|minor|major   bump from package.json
  --version X.Y.Z            set this version
  --title TEXT               GitHub release title (default: vX.Y.Z)
  --notes TEXT               GitHub release notes (default: commit log)
  --dry-run                  build and pack only; no publish, tag, or gh
  --skip-npm                 skip npm publish
  --skip-bin                 skip compiled binaries
  --skip-gh                  skip git tag and GitHub release
  --allow-dirty              allow uncommitted files (npm tarball will not match the tag)
`);
      process.exit(0);
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  return args;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

function capture(cmd: string[]): string {
  const result = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = new TextDecoder().decode(result.stdout).trim();
  const err = new TextDecoder().decode(result.stderr).trim();
  if (result.exitCode !== 0) fail(err || `${cmd.join(" ")} failed`);
  return out;
}

function tryCapture(cmd: string[]): string {
  const result = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return "";
  return new TextDecoder().decode(result.stdout).trim();
}

function readPkg(): { version: string } & Record<string, unknown> {
  return JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string } & Record<string, unknown>;
}

function writePkgVersion(version: string): void {
  const pkg = readPkg();
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function bumpVersion(current: string, kind: "patch" | "minor" | "major"): string {
  const parts = current.split(".").map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) fail(`bad version ${current}`);
  const [major, minor, patch] = parts as [number, number, number];
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function semver(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version must be X.Y.Z, got ${version}`);
  return version;
}

function tagExists(tag: string): boolean {
  return Boolean(tryCapture(["git", "tag", "-l", tag]));
}

function dirtyFiles(): string[] {
  const status = tryCapture(["git", "status", "--porcelain"]);
  if (!status) return [];
  return status.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
}

function nextVersion(current: string, args: Args): string {
  if (args.version) return semver(args.version);
  if (args.bump) return bumpVersion(current, args.bump);
  if (tagExists(`v${current}`)) return bumpVersion(current, "patch");
  return current;
}

function releaseNotes(version: string): string {
  const previous = tryCapture(["git", "describe", "--tags", "--abbrev=0"]);
  const range = previous ? `${previous}..HEAD` : "HEAD";
  const log = tryCapture(["git", "log", "--pretty=format:- %s", range]) || "- (no commits)";
  return `## v${version}\n\n${log}\n`;
}

function binAssets(): string[] {
  const dist = join(root, "dist");
  if (!existsSync(dist)) return [];
  return readdirSync(dist)
    .filter((name) => name.startsWith("barney-") && !name.endsWith(".zip"))
    .map((name) => join(dist, name))
    .filter((path) => existsSync(path));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const pkg = readPkg();
  const version = nextVersion(String(pkg.version), args);
  const tag = `v${version}`;
  const dirty = dirtyFiles().filter((path) => path !== "package.json");

  if (dirty.length && !args.allowDirty) {
    fail(`working tree is dirty:\n${dirty.map((path) => `  ${path}`).join("\n")}\nCommit or pass --allow-dirty.`);
  }
  if (tagExists(tag) && !args.dryRun && !args.skipGh) {
    fail(`tag ${tag} already exists`);
  }

  console.log(`${args.dryRun ? "dry-run " : ""}release ${pkg.name}@${version}`);
  if (String(pkg.version) !== version) {
    if (args.dryRun) console.log(`would set package.json version ${pkg.version} → ${version}`);
    else {
      writePkgVersion(version);
      console.log(`package.json version ${pkg.version} → ${version}`);
    }
  }

  run(["bun", "run", "typecheck"]);
  run(["bun", "run", "build:web"]);
  run(["npm", "pack", "--dry-run"]);

  if (!args.skipNpm && !args.dryRun) {
    const publish = ["npm", "publish", "--access", "public"];
    if (process.env.NPM_OTP) publish.push("--otp", process.env.NPM_OTP);
    run(publish);
  } else if (args.skipNpm) {
    console.log("skip npm publish");
  }

  if (!args.skipBin) {
    run(["bun", "run", "scripts/build-bin.ts", "all"]);
  } else {
    console.log("skip binaries");
  }

  if (args.dryRun || args.skipGh) {
    if (args.dryRun) console.log(`would tag ${tag} and create GitHub release`);
    return;
  }

  const notes = args.notes?.trim() || releaseNotes(version);
  const title = args.title?.trim() || tag;
  // Release script edits are local tooling; keep the version bump commit clean.
  const releaseDirty = dirtyFiles().filter((path) => path !== "scripts/release.ts");
  if (releaseDirty.includes("package.json") || String(pkg.version) !== version) {
    run(["git", "add", "package.json"]);
    run(["git", "commit", "-m", `Release ${tag}`]);
  }
  run(["git", "tag", tag]);
  run(["git", "push", "origin", "HEAD", tag]);

  const assets = binAssets();
  if (!assets.length && !args.skipBin) fail("no binaries in dist/");
  run([
    "gh",
    "release",
    "create",
    tag,
    "--title",
    title,
    "--notes",
    notes,
    ...assets,
  ]);
  console.log(`published ${pkg.name}@${version} and ${tag}`);
}

main();
