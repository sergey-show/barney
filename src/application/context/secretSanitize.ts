/**
 * Secret sanitize law — production loop.
 *
 * find DETECTED_SECRET_* → replace with user <your-…> → tree-wide verify → else fail and mutate again.
 * Guard masks stay; disk holds live secrets until sed/fs_edit writes placeholders.
 */

const SECRET_TOKEN_RE = /DETECTED_SECRET_[A-Z0-9]+_[A-F0-9]+/g;
const PLACEHOLDER_RE = /<your-[a-z0-9-]+>/gi;

export function askedToReplaceSecrets(latest: string): boolean {
  return /<your-[a-z0-9-]+>/i.test(latest)
    || /\breplace secrets\b/i.test(latest)
    || /\bsanitize\b/i.test(latest)
    || /\bplaceholder values\b/i.test(latest)
    || /\bdecontaminat/i.test(latest)
    || (/\bredact\b/i.test(latest) && /\b(secret|key|token|credential)/i.test(latest));
}

export function requestedPlaceholders(latest: string): string[] {
  const found = latest.match(PLACEHOLDER_RE) ?? [];
  return [...new Set(found.map((token) => token.toLowerCase()))];
}

export function secretMasksSeen(evidence: string): string[] {
  const found = evidence.match(SECRET_TOKEN_RE) ?? [];
  return [...new Set(found)];
}

/** Successful sed -i / fs_edit|fs_write that substitutes mask → placeholder. */
export function isSecretReplaceMutate(block: string): boolean {
  const head = block.split("\n")[0] ?? "";
  if (/^fs_edit /.test(head) || /^fs_write /.test(head)) {
    if (/^error:/im.test(block) || /^BLOCKED:/im.test(block)) return false;
    return /DETECTED_SECRET_|<your-[a-z0-9-]+>/i.test(head);
  }
  if (!/^shell /.test(head)) return false;
  if (!/\bsed\b/i.test(head) || !/-i\b/.test(head)) return false;
  if (!/^exit 0\b/m.test(block)) return false;
  return /DETECTED_SECRET_|<your-[a-z0-9-]+>/i.test(head);
}

export function isSecretContentProbe(block: string): boolean {
  const head = block.split("\n")[0] ?? "";
  if (/^fs_read /.test(head)) return true;
  if (!/^shell /.test(head)) return false;
  if (/\bsed\b/i.test(head) && /-i\b/.test(head)) return false;
  return /\b(?:grep|rg|cat|sed|head|tail|find)\b/i.test(head);
}

/**
 * Tree-wide probe: recursive grep/rg/find over `.` (or multi-path), not a single-file peek.
 * Required after sanitize mutate so leftover masks in other files cannot hide.
 */
export function isTreeWideSecretProbe(block: string): boolean {
  if (!isSecretContentProbe(block)) return false;
  const head = block.split("\n")[0] ?? "";
  if (/^fs_read /.test(head)) return false;
  const command = shellCommandFromHead(head);
  if (!command) return false;
  if (/\b(?:-r|-R|--recursive)\b/.test(command)) return true;
  if (/\b(?:rg|find)\b/.test(command) && /DETECTED_SECRET|AKIA|ghp_|hf_/.test(command)) return true;
  // grep … .   or grep … . --exclude-dir=
  if (/\bgrep\b[\s\S]*\s\.(?:\s|$)/.test(command)) return true;
  return false;
}

export function shellCommandFromHead(head: string): string {
  if (!head.startsWith("shell ")) return "";
  try {
    const parsed = JSON.parse(head.slice("shell ".length)) as { command?: string };
    return String(parsed.command ?? "");
  } catch {
    return head.slice("shell ".length);
  }
}

/**
 * After replace, evidence must show a clean **tree-wide** probe with no DETECTED_SECRET_* left,
 * and user-requested <your-…> placeholders must appear in mutate/probe evidence.
 */
export function leftoverSecretMasks(latest: string, evidence: string): string | undefined {
  if (!askedToReplaceSecrets(latest)) return;
  const masks = secretMasksSeen(evidence);
  if (!masks.length && !/DETECTED_SECRET_/i.test(evidence)) return;

  const blocks = toolBlocks(evidence);
  let lastMutate = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (isSecretReplaceMutate(blocks[i] ?? "")) lastMutate = i;
  }
  if (lastMutate < 0) {
    return "secrets still present as DETECTED_SECRET_* — replace with <your-…> placeholders via sed -i or fs_edit (do not wait for go-ahead)";
  }

  let sawTreeVerify = false;
  for (let i = lastMutate + 1; i < blocks.length; i++) {
    const block = blocks[i] ?? "";
    if (!isTreeWideSecretProbe(block)) continue;
    sawTreeVerify = true;
    const body = block.split("\n").slice(1).join("\n");
    if (/DETECTED_SECRET_/i.test(body)) {
      return "DETECTED_SECRET_* still on disk after replace — finish every mask hash with <your-…> and re-check tree-wide";
    }
  }
  for (const body of latestFileBodies(evidence).values()) {
    if (/DETECTED_SECRET_/i.test(body)) {
      return "DETECTED_SECRET_* still on disk after replace — finish every mask hash with <your-…> and re-check";
    }
  }
  if (!sawTreeVerify) {
    return "replaced secrets but did not tree-verify — run: grep -r DETECTED_SECRET_ . --exclude-dir=.git (must be empty)";
  }

  const wanted = requestedPlaceholders(latest);
  if (wanted.length) {
    const after = blocks.slice(lastMutate).join("\n").toLowerCase();
    const missing = wanted.filter((token) => !after.includes(token));
    if (missing.length) {
      return `placeholders missing after replace: ${missing.join(", ")} — write those exact strings, not house/barney-redact tokens`;
    }
  }
}

/** Persist / recovery nudge when sanitize is still open. */
export function secretSanitizePersistNudge(latest: string, evidence: string): string {
  const masks = secretMasksSeen(evidence);
  const placeholders = requestedPlaceholders(latest);
  const ph = placeholders.length
    ? placeholders.join(", ")
    : "<your-aws-access-key-id> (and the other <your-…> from the user)";
  if (!evidenceHasSuccessfulSecretMutate(evidence)) {
    const list = masks.length
      ? `Known masks to replace now: ${masks.join(", ")}.`
      : "Find DETECTED_SECRET_<KIND>_<HASH> tokens in tool output.";
    return [
      "Sanitize: do not inventory further and do not wait for go-ahead.",
      list,
      `Apply sed -i 's/DETECTED_SECRET_…/${placeholders[0] ?? "<your-…>"}/g' (or fs_edit) for every mask → ${ph}.`,
      "Then tree-verify: grep -r DETECTED_SECRET_ . --exclude-dir=.git must print nothing.",
    ].join(" ");
  }
  return [
    "Sanitize mutate happened — finish with tree-wide verify.",
    "Run: grep -r DETECTED_SECRET_ . --exclude-dir=.git (must be empty).",
    `Confirm placeholders on disk: ${ph}.`,
    "If any mask remains, sed that hash immediately; do not ask the operator.",
  ].join(" ");
}

export function evidenceHasSuccessfulSecretMutate(evidence: string): boolean {
  return toolBlocks(evidence).some((block) => isSecretReplaceMutate(block));
}

/** Shell call that advances sanitize (mutate or tree verify) — exempt from wanting saturation. */
export function isSecretSanitizeProgressCall(call: {
  name: string;
  arguments?: Record<string, unknown>;
}): boolean {
  if (call.name === "shell") {
    const command = String(call.arguments?.command ?? "");
    if (/\bsed\b/i.test(command) && /-i\b/.test(command) && /DETECTED_SECRET_/.test(command)) return true;
    if (/\b(?:grep|rg)\b/i.test(command) && /DETECTED_SECRET_/.test(command) && /(?:-r|-R|--recursive|\s\.)/.test(command)) {
      return true;
    }
  }
  if (call.name === "fs_edit" || call.name === "fs_write") {
    const blob = JSON.stringify(call.arguments ?? {});
    return /DETECTED_SECRET_/.test(blob) && /<your-[a-z0-9-]+>/i.test(blob);
  }
  return false;
}

export function postSecretMutateObserve(call: {
  name: string;
  arguments?: Record<string, unknown>;
}, out: string): string | undefined {
  if (!isSecretSanitizeProgressCall(call)) return;
  if (call.name === "shell") {
    const command = String(call.arguments?.command ?? "");
    if (!/\bsed\b/i.test(command) || !/-i\b/.test(command)) return;
    if (!/^exit 0\b/m.test(out) && !/\nok\b/i.test(out)) return;
  }
  if (/^error:/im.test(out) || /^BLOCKED:/im.test(out)) return;
  return "Sanitize mutate landed — tree-verify next: grep -r DETECTED_SECRET_ . --exclude-dir=.git must be empty; confirm <your-…> placeholders appear.";
}

/** Go-ahead / approval is never a reason to stop sanitize — operator already asked for the work. */
export function sanitizeRejectsGoAhead(latest: string, reply: string): boolean {
  if (!askedToReplaceSecrets(latest)) return false;
  return /ready to execute|on your go-ahead|awaiting (your )?approval|planned replacements|next turn/i.test(reply);
}

function toolBlocks(evidence: string): string[] {
  const blocks: string[] = [];
  let current = "";
  for (const line of evidence.split("\n")) {
    if (/^(?:fs_|shell |browser_|plugin_|memory_|mcp_|agent_|self_|plan_|process_|board_)/.test(line)) {
      if (current) blocks.push(current);
      current = line;
      continue;
    }
    if (current) current += `\n${line}`;
  }
  if (current) blocks.push(current);
  return blocks;
}

function latestFileBodies(evidence: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const block of toolBlocks(evidence)) {
    if (block.startsWith("fs_write ") || block.startsWith("fs_edit ")) {
      const raw = block.replace(/^fs_(?:write|edit) /, "").split("\n")[0] ?? "";
      try {
        const parsed = JSON.parse(raw) as { path?: string; content?: string; new?: string };
        const path = parsed.path;
        const content = parsed.content ?? parsed.new ?? "";
        if (path) bodies.set(path, content);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (block.startsWith("fs_read ")) {
      const path = /"path"\s*:\s*"([^"]+)"/.exec(block.split("\n")[0] ?? "")?.[1];
      if (!path) continue;
      const body = block.split("\n").slice(1).join("\n");
      if (body) bodies.set(path, body);
    }
  }
  return bodies;
}
