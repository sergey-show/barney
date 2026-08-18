export type ReplyMeta = {
  tokens: number;
  ms: number;
  model: string;
};

export function replyMetaFrom(input: { tokens?: number; ms?: number; model?: string }): ReplyMeta | undefined {
  const tokens = input.tokens ?? 0;
  const ms = input.ms ?? 0;
  const model = input.model?.trim() ?? "";
  if (!tokens && !ms && !model) return undefined;
  return { tokens, ms, model };
}

export function formatReplyFootnote(meta?: ReplyMeta | null): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.tokens > 0) parts.push(`${meta.tokens.toLocaleString("en-US")} tok`);
  if (meta.ms > 0) parts.push(formatDuration(meta.ms));
  if (meta.model) parts.push(meta.model);
  return parts.join(" · ");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}
