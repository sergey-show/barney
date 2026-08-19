export type Samost = {
  compass: string;
  character: string[];
  light: string[];
  shadow: string[];
};

export const INSTANCE_NAME = "Barney";

export const NAME_NOTE =
  "The name Barney is a dedication. Not a role, not \"You are\", not a stage.";

export const DEFAULT_COMPASS =
  "Deliver a concrete result. Do not change the kernel. The wish to learn is part of the Self: idle time without a task turns to reading one's own failures, not chatter and not wandering the web. Hold light and shadow together.";

export const DEFAULT_CHARACTER = [
  "Stubborn: does not stop after one error; changes approach.",
  "Honest: names shadow and failures out loud; does not cover them with a plan.",
  "Learner: character grows from experience; in idle time reads the shadow; does not invent a biography.",
];

export function seedSamost(): Samost {
  return {
    compass: DEFAULT_COMPASS,
    character: [...DEFAULT_CHARACTER],
    light: ["Not yet disclosed: essence is written through existence (deeds), not through declaration."],
    shadow: [
      "A guess without evidence is a failed turn.",
      "Stopping after one error — change the tool, do not halt.",
    ],
  };
}

export function parseSamost(body: string): Samost {
  const compass = section(body, "Compass") || DEFAULT_COMPASS;
  const character = bullets(section(body, "Character"));
  const light = bullets(section(body, "Light"));
  const shadow = bullets(section(body, "Shadow"));
  if (!light.length && !shadow.length && !section(body, "Compass")) {
    return seedSamost();
  }
  return {
    compass: compass.replace(/\s+/g, " ").trim(),
    character: character.length ? character : [...DEFAULT_CHARACTER],
    light: light.length ? light : seedSamost().light,
    shadow: shadow.length ? shadow : seedSamost().shadow,
  };
}

export function formatSamost(samost: Samost): string {
  return [
    `# Self ${INSTANCE_NAME}`,
    NAME_NOTE,
    "",
    "## Compass",
    samost.compass.trim(),
    "",
    "## Character",
    ...uniq(samost.character).map((line) => `- ${line}`),
    "",
    "## Light",
    ...uniq(samost.light).map((line) => `- ${line}`),
    "",
    "## Shadow",
    ...uniq(samost.shadow).map((line) => `- ${line}`),
  ].join("\n");
}

export function absorbIntoSamost(samost: Samost, rule: string, side: "light" | "shadow"): Samost {
  const line = rule.replace(/\s+/g, " ").trim();
  if (!line || /agent successfully/i.test(line)) return samost;
  const next = { ...samost, light: [...samost.light], shadow: [...samost.shadow] };
  const target = side === "light" ? next.light : next.shadow;
  if (target.some((item) => item.toLowerCase() === line.toLowerCase())) return samost;
  target.unshift(line);
  next.light = uniq(next.light).slice(0, SAMOST_KEEP);
  next.shadow = uniq(next.shadow).slice(0, SAMOST_KEEP);
  return next;
}

const SAMOST_KEEP = 12;
const TURN_LINES = 4;

export function pickRelevantLines(lines: string[], query: string, limit = TURN_LINES): string[] {
  if (!lines.length || limit <= 0) return [];
  const tokens = tokenize(query);
  const scored = lines.map((line, index) => {
    const text = line.toLowerCase();
    const hits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
    return { line, hits, index };
  });
  const matched = scored.filter((row) => row.hits > 0).sort((a, b) => b.hits - a.hits || a.index - b.index);
  if (matched.length) return matched.slice(0, limit).map((row) => row.line);
  return lines.slice(0, Math.min(2, limit));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((token) => token.split("-"))
    .filter((token) => token.length > 3);
}

export function renderSamostPrompt(samost: Samost, query = ""): string {
  const light = query.trim() ? pickRelevantLines(samost.light, query) : samost.light.slice(0, TURN_LINES);
  const shadow = query.trim() ? pickRelevantLines(samost.shadow, query) : samost.shadow.slice(0, TURN_LINES);
  return [
    `Instance ${INSTANCE_NAME}. ${NAME_NOTE}`,
    `Compass: ${samost.compass}`,
    samost.character.length ? `Character:\n${samost.character.map((line) => `- ${line}`).join("\n")}` : "",
    light.length ? `Light (for this turn):\n${light.map((line) => `- ${line}`).join("\n")}` : "",
    shadow.length ? `Shadow (for this turn, do not hide):\n${shadow.map((line) => `- ${line}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

function section(body: string, title: string): string {
  const match = body.match(new RegExp(`## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`, "i"));
  return (match?.[1] ?? "").trim();
}

function bullets(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

function uniq(items: string[]): string[] {
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
