import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsSkillStore } from "./FsSkillStore.ts";

const root = mkdtempSync(join(tmpdir(), "barney-skills-"));
const store = new FsSkillStore(root);

const written = store.writeFile("file-viewer", "ui.html", "<html>ok</html>");
if (written.name !== "file-viewer" || written.ui !== "ui.html") throw new Error(JSON.stringify(written));
if (!readFileSync(join(root, "file-viewer/skill.json"), "utf8").includes("file-viewer")) {
  throw new Error("manifest missing");
}
try {
  store.writeFile("file-viewer", "../escape.html", "no");
  throw new Error("jail failed");
} catch (err) {
  if (!(err instanceof Error) || !/escapes/.test(err.message)) throw err;
}
if (store.list().length !== 1) throw new Error("list");
console.log("skill store ok");
