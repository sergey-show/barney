const MIN_CYCLE = 32;
const REPEATS = 3;
const MAX_CYCLE = 240;

export function generationLooped(text: string): boolean {
  return Boolean(findCycle(text));
}

export function trimLooped(text: string): string {
  const cycle = findCycle(text);
  if (!cycle) return text;
  const index = text.indexOf(cycle);
  if (index < 0) return text;
  return text.slice(0, index + cycle.length).trimEnd();
}

function findCycle(text: string): string | null {
  return findCharCycle(text) ?? findLineCycle(text);
}

function findCharCycle(text: string): string | null {
  const maxCycle = Math.min(MAX_CYCLE, Math.floor(text.length / REPEATS));
  if (maxCycle < MIN_CYCLE) return null;
  const tail = text.slice(-(maxCycle * REPEATS));
  for (let n = MIN_CYCLE; n <= maxCycle; n++) {
    const cycle = tail.slice(-n);
    if (cycle.trim().length < MIN_CYCLE) continue;
    let matched = true;
    for (let i = 1; i < REPEATS; i++) {
      if (tail.slice(-n * (i + 1), -n * i) !== cycle) {
        matched = false;
        break;
      }
    }
    if (matched) return cycle;
  }
  return null;
}

function findLineCycle(text: string): string | null {
  const lines = text.split(/\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  if (lines.length < REPEATS * 2) return null;
  const last = lines.slice(-18);
  for (const period of [1, 2, 3, 4]) {
    if (last.length < period * REPEATS) continue;
    const unit = last.slice(-period);
    const joined = unit.join("\n");
    if (joined.trim().length < 20) continue;
    let matched = true;
    for (let i = 1; i < REPEATS; i++) {
      const prev = last.slice(-period * (i + 1), -period * i);
      if (prev.join("\n") !== joined) {
        matched = false;
        break;
      }
    }
    if (matched) return `${joined}\n`;
  }
  return null;
}
