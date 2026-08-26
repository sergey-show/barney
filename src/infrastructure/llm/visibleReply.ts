const THINK_OPEN = /^(wait[,.]?\s|okay[,.]?\s|ok,\s|hmm[,.]?\s|the user (asked|wants|said|is asking|requested)|looking closely\b|the first search\b|no (search )?results\b|let me (check|look|see|verify|inspect|read|think|try|search|open)|i (should|need to|will|think i|see that|notice|remember|said|missed)\b|actually[,.]?\s|previous turn\b|hold on\b|on second thought\b|ah[!.,]\s|let's (stick|check|look|see|fix|try|search)|i'll (fix|check|look|reply|output|try|search)|подождите|подожди|пользователь (спросил|просит|написал)|мне (нужно|следует)|итак,|давай (провер|посмотр)|я (сейчас отвечу|подумал|должен проверить)|好的[，,]?用户|用户(问|说)|我需要|让我)/i;

const TOOL_MENTION = /\b(web_search|browser_open|browser_click|fs_write|fs_read|fs_edit|memory_search|plugin_write)\b/;

const PLAN_TALK = /\b(let me (try|search|open|look)|i'll (try|search|open)|no (search )?results|first search|other sources|try searching|try a different|try other)\b/i;

const HANDOVER_LINE = /^(?:I will (?:now )?(?:reply|answer|respond)|Let me (?:now )?(?:reply|answer|respond)|Final answer|Ответ|Вот ответ)\b/i;

const HANDOVER_SPLIT = /(?:^|\n)((?:I will (?:now )?(?:reply|answer|respond)|Let me (?:now )?(?:reply|answer|respond)|Final answer|Ответ|Вот ответ)\b[^\n]*)\n+/i;

const VERIFY_LINE = /^(?:\d+\.\s*)?(?:Check against Evidence|Self-Correction|The prompt says|Matches evidence\?|Do not invent\?|Markdown format\?|Check IDs|Everything looks solid|I will present the final|I will produce just|Rewrite the visible reply)\b/i;

const VERIFY_ANY = /Self-Correction|Verification during thought|Check against Evidence|The prompt says "Rewrite|Matches evidence\?/i;

const META_SENTENCE = /\s*I should (?:state|say|reply|answer|keep) this[^.!?\n]{0,80}[.!?]?\s*/gi;

const SUFFIX_CUT = /\n(?:\d+\.\s*)?(?:Check against Evidence|Self-Correction|The prompt says|Everything looks solid|I will present the final|I will produce just)/i;

export function peelUntaggedThinking(text: string): { text: string; thinking: string } {
  const tagged = splitThinkTags(text);
  const chunks = [tagged.thinking];
  let body = tagged.text.trim();
  if (!body) return { text: "", thinking: chunks.filter(Boolean).join("\n\n") };

  if (isPlanNarration(body) && !hasUserFacingTail(body)) {
    chunks.push(body);
    return { text: "", thinking: chunks.filter((chunk) => chunk.trim()).join("\n\n") };
  }

  const handed = splitHandover(body);
  if (handed) {
    chunks.push(handed.thinking);
    body = handed.text;
  }

  const prefix = peelPrefix(body);
  chunks.push(prefix.thinking);
  body = prefix.text;

  const suffix = peelSuffix(body);
  chunks.push(suffix.thinking);
  body = scrubVisible(suffix.text);

  return { text: body, thinking: chunks.filter((chunk) => chunk.trim()).join("\n\n") };
}

export function visibleAssistantText(text: string): string {
  const peeled = peelUntaggedThinking(text);
  if (peeled.thinking && !peeled.text.trim()) return "";
  return peeled.text || text.trim();
}

function splitThinkTags(text: string): { text: string; thinking: string } {
  const blocks: string[] = [];
  let next = text.replace(/```thinking\n([\s\S]*?)```/gi, (_, inner: string) => {
    if (inner.trim()) blocks.push(inner.trim());
    return "\n\n";
  });
  next = next.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner: string) => {
    if (inner.trim()) blocks.push(inner.trim());
    return "\n\n";
  });
  const unclosed = next.match(/^<think>([\s\S]*)$/i);
  if (unclosed) {
    const inner = unclosed[1].trim();
    const parts = inner.split(/\n{2,}/).filter(Boolean);
    if (parts.length >= 2) {
      blocks.push(parts.slice(0, -1).join("\n\n"));
      next = parts.at(-1) ?? "";
    } else {
      blocks.push(inner);
      next = "";
    }
  }
  const close = next.search(/<\/think>/i);
  if (close >= 0) {
    const before = next.slice(0, close).replace(/^<think>/i, "").trim();
    if (before) blocks.push(before);
    next = next.slice(close).replace(/<\/think>/i, "");
  }
  next = next.replace(/<\/?think>/gi, "").trim();
  return { text: next, thinking: blocks.filter(Boolean).join("\n\n") };
}

function peelPrefix(trimmed: string): { text: string; thinking: string } {
  const paras = trimmed.split(/\n{2,}/).map((para) => para.trim()).filter(Boolean);
  if (paras.length < 2) return { text: trimmed, thinking: "" };

  const flags = classifyParas(paras);
  let start = paras.length;
  for (let i = paras.length - 1; i >= 0; i -= 1) {
    if (flags[i]) break;
    start = i;
  }
  if (start <= 0 || start >= paras.length) return { text: trimmed, thinking: "" };

  const thinking = paras.slice(0, start).join("\n\n");
  const visible = paras.slice(start).join("\n\n");
  if (!shouldPeel(thinking, visible, flags.slice(0, start))) {
    return { text: trimmed, thinking: "" };
  }
  return { text: visible, thinking };
}

function peelSuffix(text: string): { text: string; thinking: string } {
  const cut = text.search(SUFFIX_CUT);
  if (cut > 40) {
    return { text: text.slice(0, cut).trim(), thinking: text.slice(cut).trim() };
  }
  const paras = text.split(/\n{2,}/).map((para) => para.trim()).filter(Boolean);
  if (paras.length < 2) return { text, thinking: "" };
  let end = paras.length;
  for (let i = paras.length - 1; i >= 1; i -= 1) {
    if (isThinkPara(paras[i]) || isVerifyPara(paras[i])) {
      end = i;
      continue;
    }
    break;
  }
  if (end >= paras.length) return { text, thinking: "" };
  return { text: paras.slice(0, end).join("\n\n"), thinking: paras.slice(end).join("\n\n") };
}

function scrubVisible(text: string): string {
  return text.replace(META_SENTENCE, " ").replace(/<\/?think>/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

function splitHandover(text: string): { text: string; thinking: string } | null {
  const match = text.match(HANDOVER_SPLIT);
  if (!match || match.index === undefined) return null;
  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index + match[0].length).trim();
  if (after) {
    if (before.length < 40 && !isThinkPara(before)) return null;
    return { thinking: [before, match[1]].filter(Boolean).join("\n\n"), text: after };
  }
  const quoted = match[1].match(/['"«]([^'"»]{8,})['"»]/);
  if (quoted && before.length > 40) {
    return { thinking: `${before}\n\n${match[1]}`.trim(), text: quoted[1].trim() };
  }
  return null;
}

function classifyParas(paras: string[]): boolean[] {
  const think = paras.map((para) => isThinkPara(para) || isVerifyPara(para));
  const out = [...think];
  for (let i = 0; i < paras.length; i += 1) {
    if (out[i] || !isFillerPara(paras[i])) continue;
    if (i > 0 && out[i - 1] && i < paras.length - 1) out[i] = true;
  }
  return out;
}

function isThinkPara(para: string): boolean {
  const first = para.trim().split("\n")[0] ?? "";
  if (isPlanNarration(para)) return true;
  if (THINK_OPEN.test(first) || HANDOVER_LINE.test(first) || VERIFY_LINE.test(first)) return true;
  return /I will (?:now )?(?:reply|answer|respond)\b/i.test(para);
}

function isPlanNarration(text: string): boolean {
  if (TOOL_MENTION.test(text) && PLAN_TALK.test(text)) return true;
  return PLAN_TALK.test(text) && /^(the first search|no (search )?results|let me try)\b/i.test(text.trim());
}

function hasUserFacingTail(text: string): boolean {
  const paras = text.split(/\n{2,}/).map((para) => para.trim()).filter(Boolean);
  if (paras.length < 2) return false;
  return paras.slice(1).some((para) => !isThinkPara(para) && !isVerifyPara(para) && para.length >= 40);
}

function isVerifyPara(para: string): boolean {
  const first = para.trim().split("\n")[0] ?? "";
  return VERIFY_LINE.test(first) || VERIFY_ANY.test(para);
}

function isFillerPara(para: string): boolean {
  const trimmed = para.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("```") || /^JSON\b/i.test(trimmed);
}

function shouldPeel(thinking: string, visible: string, prefixFlags: boolean[]): boolean {
  const thinkCount = prefixFlags.filter(Boolean).length;
  if (thinkCount === 0) return false;
  if (isPlanNarration(thinking)) return true;
  if (HANDOVER_LINE.test(thinking) || /I will (?:now )?(?:reply|answer|respond)\b/i.test(thinking)) return true;
  if (isMostlyLatin(thinking) && isMostlyCyrillic(visible)) return true;
  if (thinkCount >= 2 && thinking.length >= 120) return true;
  if (thinkCount >= 1 && thinking.length >= 80 && THINK_OPEN.test(thinking)) return true;
  return false;
}

function isMostlyCyrillic(text: string): boolean {
  const { cyr, lat } = scriptScore(text);
  return cyr >= 12 && cyr > lat * 0.6;
}

function isMostlyLatin(text: string): boolean {
  const { cyr, lat } = scriptScore(text);
  return lat >= 40 && lat > cyr * 2;
}

function scriptScore(text: string): { cyr: number; lat: number } {
  return {
    cyr: (text.match(/\p{Script=Cyrillic}/gu) ?? []).length,
    lat: (text.match(/\p{Script=Latin}/gu) ?? []).length,
  };
}
