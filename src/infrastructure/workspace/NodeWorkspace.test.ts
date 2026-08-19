import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeWorkspace } from "./NodeWorkspace.ts";

const root = mkdtempSync(join(tmpdir(), "barney-ws-"));
mkdirSync(join(root, "src"));
writeFileSync(join(root, "readme.md"), "hello token=ghp_examplesecretvalue123");
writeFileSync(join(root, "src", "app.ts"), "export const n = 1;\n");

const ws = new NodeWorkspace(root, (text) => text.replace(/ghp_[A-Za-z0-9]+/g, "{{SECRET:token:hash}}"));

const listed = await ws.list(".");
if (!listed.includes("readme.md") || !listed.includes("src")) throw new Error(`list: ${listed}`);

const read = await ws.read("readme.md");
if (read.includes("ghp_")) throw new Error(`secret leaked: ${read}`);
if (!read.includes("{{SECRET:token:hash}}")) throw new Error(`mask missing: ${read}`);

await ws.write("src/nested/note.txt", "ok");
const nested = await ws.read("src/nested/note.txt");
if (nested !== "ok") throw new Error(nested);

await ws.append("src/nested/note.txt", "line2");
const appended = await ws.read("src/nested/note.txt");
if (appended !== "ok\nline2") throw new Error(`append: ${appended}`);

await ws.edit("src/nested/note.txt", "line2", "line3");
const edited = await ws.read("src/nested/note.txt");
if (edited !== "ok\nline3") throw new Error(`edit: ${edited}`);

let editFailed = false;
try {
  await ws.edit("src/nested/note.txt", "missing", "x");
} catch (err) {
  editFailed = err instanceof Error && err.message.includes("not found");
}
if (!editFailed) throw new Error("edit should fail when old is missing");

const hits = await ws.search("export const");
if (!hits.includes("src/app.ts")) throw new Error(`search: ${hits}`);

let escaped = false;
try {
  ws.resolveSafe("../outside.txt");
} catch {
  escaped = true;
}
if (!escaped) throw new Error("jail failed for ../");

escaped = false;
try {
  ws.resolveSafe("src/../../outside.txt");
} catch {
  escaped = true;
}
if (!escaped) throw new Error("jail failed for nested ..");

const insideAbs = join(root, "src", "app.ts");
if (ws.resolveSafe(insideAbs) !== resolve(insideAbs)) throw new Error(`abs inside: ${ws.resolveSafe(insideAbs)}`);
await ws.write(`${root.replaceAll("\\", "/")}/from-abs.txt`, "tb");
if ((await ws.read("from-abs.txt")) !== "tb") throw new Error("absolute worktree path should map into the jail");

escaped = false;
try {
  ws.resolveSafe("/tmp/barney-outside-jail.txt");
} catch {
  escaped = true;
}
if (!escaped) throw new Error("jail failed for absolute path outside the worktree");

const sh = await ws.shell("echo hello-barney");
if (!sh.includes("hello-barney")) throw new Error(`shell: ${sh}`);

let blocked = false;
try {
  await ws.shell("sudo ls");
} catch (err) {
  blocked = err instanceof Error && err.message.includes("blocked");
}
if (!blocked) throw new Error("shell should block sudo");

const secretRoot = mkdtempSync(join(tmpdir(), "barney-secret-"));
writeFileSync(join(secretRoot, "keys.env"), "AWS_ACCESS_KEY_ID=AKIA1234567890123456\n");
const secretWs = new NodeWorkspace(
  secretRoot,
  (text) => text.replace("AKIA1234567890123456", "DETECTED_SECRET_AWS_ACCESS_KEY_1"),
  (text) => text.replace("DETECTED_SECRET_AWS_ACCESS_KEY_1", "AKIA1234567890123456"),
);
const found = await secretWs.search("DETECTED_SECRET_AWS_ACCESS_KEY_1");
if (!found.includes("keys.env")) throw new Error(`search unmask: ${found}`);
await secretWs.edit("keys.env", "AWS_ACCESS_KEY_ID=DETECTED_SECRET_AWS_ACCESS_KEY_1", "AWS_ACCESS_KEY_ID=<your-aws-access-key-id>");
const editedKeys = await secretWs.read("keys.env");
if (editedKeys.includes("AKIA") || !editedKeys.includes("<your-aws-access-key-id>")) {
  throw new Error(`edit unmask: ${editedKeys}`);
}
writeFileSync(join(secretRoot, "keys.env"), "AWS_ACCESS_KEY_ID=AKIA1234567890123456\n");
const sed = await secretWs.shell("sed 's/DETECTED_SECRET_AWS_ACCESS_KEY_1/<your-aws-access-key-id>/' keys.env");
if (!sed.includes("<your-aws-access-key-id>") || sed.includes("AKIA1234567890123456")) {
  throw new Error(`shell unmask: ${sed}`);
}

const appRoot = join(mkdtempSync(join(tmpdir(), "barney-app-")), "app");
mkdirSync(appRoot, { recursive: true });
const appWs = new NodeWorkspace(appRoot, (text) => text);
await appWs.write("app/out/report.txt", "from-prefix");
if ((await appWs.read("out/report.txt")) !== "from-prefix") {
  throw new Error("worktree-named prefix should map to a path inside the jail");
}

console.log("workspace jail ok");
