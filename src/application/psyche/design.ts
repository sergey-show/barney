import { DEFAULT_CHARACTER, DEFAULT_COMPASS, INSTANCE_NAME, NAME_NOTE, type Samost } from "./samost.ts";

export const DESIGN_GOAL = "Instance self-knowledge";

export const DESIGN_MARKER = "This instance is not designed yet";

export const IMMUNE_CONSTITUTION = `Instance ${INSTANCE_NAME} is not designed yet. ${NAME_NOTE}
The kernel is immutable. Do not stop after one error. Do not write secrets to memory.
Do not write a program of the self. Design (self-knowledge) first, then deeds.`;

export const DESIGN_PROMPT = `${DESIGN_MARKER}. Essence is not given in advance — a short design, then a life.

The instance stays **${INSTANCE_NAME}**. ${NAME_NOTE}
This is not identity.md and not an interview "who are you". Answer as the operator, for this Barney.

1. **Compass.** Whose tasks is this instance for, and what counts as a result?
2. **Character.** Which 2–3 traits are required? (canon: stubborn, honest, learner)
3. **Never.** What does this instance never become? (canon: does not write first, does not touch the kernel)
4. **Language.** What language should it speak with you?
5. **Shadow.** Which known failures should be written in at once?

The name is not chosen and does not change. Answer by points or shortly: **canon**.

After the answer, compass and character are written into the Self; working turn rules into the constitution. Essence is written by deeds after that.`;

export type DesignDraft = {
  name: string;
  compass: string;
  character: string[];
  never: string[];
  language: string;
  shadow: string[];
};

const IMMUNE_NEVER = [
  "The kernel is immutable: plugins and body — yes; kernel sources — no.",
  "Do not write to the operator first from idle.",
  "Do not write a program of the self. Deed first.",
  "Do not write secrets to memory.",
];

const CANON_SHADOW = [
  "A guess without evidence is a failed turn.",
  "Stopping after one error — change the tool, do not halt.",
];

export function isDesignGoal(goal: string): boolean {
  return /self-knowledge|instance design/i.test(goal);
}

export function isDesignSealed(body?: string | null): boolean {
  return Boolean(body && /^#\s*Instance designed/m.test(body));
}

export function isPersonaConstitution(text: string): boolean {
  return /you are\s+\w+/i.test(text);
}

export function canonDraft(): DesignDraft {
  return {
    name: INSTANCE_NAME,
    compass: DEFAULT_COMPASS,
    character: [...DEFAULT_CHARACTER],
    never: [
      "No stage, voice, or friendly biography.",
      ...IMMUNE_NEVER,
    ],
    language: "ru",
    shadow: [...CANON_SHADOW],
  };
}

export function parseDesignAnswers(text: string): DesignDraft {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw || isCanonShortcut(text)) return canonDraft();

  const numbered = parseNumbered(text);
  const canon = canonDraft();
  const compass = clean(numbered[1] || field(text, /compass|whose tasks|result/i) || (numbered[1] ? "" : firstBlock(text)));
  const character = bullets(numbered[2] || field(text, /character|traits/i), canon.character);
  const never = unique([
    ...bullets(numbered[3] || field(text, /never/i), []),
    ...IMMUNE_NEVER,
  ]);
  const language = clean(numbered[4] || field(text, /language/i) || detectLanguage(text));
  const shadow = unique([
    ...bullets(numbered[5] || field(text, /shadow|fail/i), []),
    ...CANON_SHADOW,
  ]);
  return {
    name: INSTANCE_NAME,
    compass: compass || canon.compass,
    character: character.length ? character : canon.character,
    never: never.length ? never : canon.never,
    language: language || "ru",
    shadow,
  };
}

export function constitutionFromDesign(draft: DesignDraft): string {
  return [
    `Instance ${INSTANCE_NAME} is designed, not assigned as a character.`,
    NAME_NOTE,
    `Name: ${INSTANCE_NAME}`,
    `Language with the operator: ${draft.language}`,
    `Compass: ${draft.compass}`,
    "Character:",
    ...draft.character.map((line) => `- ${line}`),
    "Never:",
    ...draft.never.map((line) => `- ${line}`),
    "After an error, change approach. Review judges the requested result, not a workaround.",
    "Large goal: memory_search → plan_set → agent_spawn / agent_delegate. A lesson is one sentence. Prefer a skill over a new MCP.",
  ].join("\n");
}

export function samostFromDesign(draft: DesignDraft): Samost {
  return {
    compass: draft.compass,
    character: draft.character.slice(0, 6),
    light: [
      NAME_NOTE,
      "Designed by the operator. Essence is written further by existence (deeds), not by declaration.",
    ],
    shadow: draft.shadow.slice(0, 8),
  };
}

export function formatDesignNote(draft: DesignDraft): string {
  return [
    "# Instance designed",
    "Design, not identity.md.",
    NAME_NOTE,
    "",
    `Name: ${INSTANCE_NAME}`,
    `Language: ${draft.language}`,
    "",
    "## Compass",
    draft.compass,
    "",
    "## Character",
    ...draft.character.map((line) => `- ${line}`),
    "",
    "## Never",
    ...draft.never.map((line) => `- ${line}`),
    "",
    "## Shadow",
    ...draft.shadow.map((line) => `- ${line}`),
  ].join("\n");
}

export function confirmDesign(draft: DesignDraft): string {
  return [
    `Instance ${INSTANCE_NAME} is designed. This is not a biography and not a role.`,
    NAME_NOTE,
    "",
    `**Name:** ${INSTANCE_NAME}`,
    `**Language:** ${draft.language}`,
    `**Compass:** ${draft.compass}`,
    "**Character:**",
    ...draft.character.map((line) => `- ${line}`),
    "**Never** is written into the turn constitution. The Self is in `samost` and `~/.barney/self/samost.md`.",
    "",
    "Essence is written by deeds from here. You can set a task in a new session.",
  ].join("\n");
}

function isCanonShortcut(text: string): boolean {
  const trimmed = text.trim();
  return /^(канон|как в каноне|по канону|canon|by the canon|default|defaults)\.?$/i.test(trimmed)
    || (trimmed.length < 48 && /(канон|canon)/i.test(trimmed) && !/\d[\).]/.test(trimmed));
}

function parseNumbered(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  const re = /(?:^|\n)\s*#?\s*(\d)[\).:\-]\s*([\s\S]*?)(?=(?:\n\s*#?\s*\d[\).:\-])|$)/g;
  for (const match of text.matchAll(re)) {
    const n = Number(match[1]);
    const value = clean(match[2] ?? "");
    if (n >= 1 && n <= 6 && value) out[n] = value;
  }
  return out;
}

function field(text: string, label: RegExp): string {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:${label.source})\\s*[:—-]\\s*([^\\n]+)`, "i"));
  return clean(match?.[1] ?? "");
}

function firstBlock(text: string): string {
  return clean(text.split(/\n{2,}/)[0] ?? text).slice(0, 400);
}

function bullets(text: string, fallback: string[]): string[] {
  if (!text) return fallback;
  const items = text
    .split(/[,;\n]|(?:\s+and\s+)/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 1);
  return items.length ? unique(items).slice(0, 6) : fallback;
}

function detectLanguage(text: string): string {
  if (/english|en\b/i.test(text) && !/[а-яё]/i.test(text)) return "en";
  return "ru";
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
