import { peelUntaggedThinking } from "./visibleReply.ts";

export type ThinkParseOptions = {
  peelUntagged?: boolean;
  tagsInContent?: boolean;
};

export class ThinkStreamFilter {
  private mode: "text" | "think" = "text";
  private hold = "";
  private textAcc = "";
  private thinkAcc = "";

  constructor(
    private readonly onThink?: (delta: string) => void,
    private readonly options: ThinkParseOptions = {},
  ) {}

  push(chunk: string): void {
    this.hold += chunk;
    this.drain(false);
  }

  finish(): { text: string; thinking: string } {
    this.drain(true);
    const text = this.textAcc.trim();
    if (this.options.peelUntagged === false) {
      return { text, thinking: this.thinkAcc };
    }
    const peeled = peelUntaggedThinking(text);
    if (peeled.thinking) this.onThink?.(peeled.thinking);
    return {
      text: peeled.text,
      thinking: [this.thinkAcc, peeled.thinking].filter((value) => value.trim()).join("\n\n"),
    };
  }

  private drain(flush: boolean): void {
    while (this.hold) {
      if (this.mode === "text") {
        const index = this.hold.toLowerCase().indexOf("<think>");
        if (index < 0) {
          const keep = flush ? 0 : 7;
          if (this.hold.length > keep) {
            this.textAcc += this.hold.slice(0, this.hold.length - keep);
            this.hold = this.hold.slice(this.hold.length - keep);
          }
          if (flush) {
            this.textAcc += this.hold;
            this.hold = "";
          }
          break;
        }
        this.textAcc += this.hold.slice(0, index);
        this.hold = this.hold.slice(index + 7);
        this.mode = "think";
        continue;
      }
      const index = this.hold.toLowerCase().indexOf("</think>");
      if (index < 0) {
        const keep = flush ? 0 : 8;
        if (this.hold.length > keep) {
          this.emitThink(this.hold.slice(0, this.hold.length - keep));
          this.hold = this.hold.slice(this.hold.length - keep);
        }
        if (flush) {
          this.emitThink(this.hold);
          this.hold = "";
        }
        break;
      }
      this.emitThink(this.hold.slice(0, index));
      this.hold = this.hold.slice(index + 8);
      this.mode = "text";
    }
  }

  private emitThink(delta: string): void {
    if (!delta) return;
    this.thinkAcc += delta;
    this.onThink?.(delta);
  }
}

export function extractReasoning(
  input: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    thinking?: string | null;
  },
  options: ThinkParseOptions = {},
): { text: string; thinking: string } {
  const extras = [input.reasoning_content, input.reasoning, input.thinking]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  let text = input.content ?? "";
  const blocks = [...extras];
  const stripTags = options.tagsInContent !== false;
  if (stripTags) {
    text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner: string) => {
      if (inner.trim()) blocks.push(inner.trim());
      return "";
    });
    text = text.replace(/```thinking\n([\s\S]*?)```/gi, (_, inner: string) => {
      if (inner.trim()) blocks.push(inner.trim());
      return "";
    });
    const unclosed = text.match(/^<think>([\s\S]*)$/i);
    if (unclosed) {
      const inner = unclosed[1].trim();
      const parts = inner.split(/\n{2,}/).filter(Boolean);
      if (parts.length >= 2) {
        blocks.push(parts.slice(0, -1).join("\n\n"));
        text = parts.at(-1) ?? "";
      } else {
        blocks.push(inner);
        text = "";
      }
    }
  }
  const trimmed = text.trim();
  if (options.peelUntagged === false) {
    return {
      text: trimmed,
      thinking: blocks.filter((value) => value.trim()).join("\n\n"),
    };
  }
  const peeled = peelUntaggedThinking(trimmed);
  return {
    text: peeled.text,
    thinking: [...blocks, peeled.thinking].filter((value) => value.trim()).join("\n\n"),
  };
}
