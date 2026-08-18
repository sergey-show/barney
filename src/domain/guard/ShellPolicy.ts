export function denyShell(command: string): string | null {
  const text = command.replace(/\s+/g, " ").trim();
  if (!text) return "empty command";
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.reason;
  }
  if (rmLeavesWorktree(text)) return "delete outside the worktree";
  return null;
}

const RULES: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(sudo|doas|pkexec)\b/i, reason: "privileged command" },
  { re: /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/i, reason: "machine power command" },
  { re: /\b(mkfs|diskutil\s+erase|format\s+[a-z]:)\b/i, reason: "disk format" },
  { re: /\bdd\b[^;\n]*\bof=\/dev\//i, reason: "raw disk write" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, reason: "fork bomb" },
  { re: /\b(kill\s+-9\s+-1|killall\s+-9)\b/i, reason: "broadcast kill" },
  { re: /\b(curl|wget|fetch)\b[^;\n|]*\|\s*(sh|bash|zsh|cmd|powershell|pwsh|python|perl)\b/i, reason: "pipe remote script to a shell" },
  { re: /\b(del\s+\/s|rd\s+\/s|rmdir\s+\/s)\b/i, reason: "recursive wipe" },
  { re: /\bchmod\b[^;\n]*\s\/(\s|$)/i, reason: "chmod on filesystem root" },
  { re: /\bchown\b[^;\n]*\s\/(\s|$)/i, reason: "chown on filesystem root" },
];

function rmLeavesWorktree(text: string): boolean {
  if (!/\brm\b/i.test(text)) return false;
  const tokens = text.split(/[\s;|&]+/).filter(Boolean);
  let seenRm = false;
  for (const token of tokens) {
    if (/^rm$/i.test(token)) {
      seenRm = true;
      continue;
    }
    if (!seenRm || token.startsWith("-")) continue;
    if (token === "/" || token.startsWith("/") || token.startsWith("~") || /^\$\{?HOME/.test(token) || token.includes("..")) {
      return true;
    }
    seenRm = false;
  }
  return false;
}
