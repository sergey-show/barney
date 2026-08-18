export const ROLES = ["planner", "researcher", "coder", "reviewer", "embedder"] as const;
export type Role = (typeof ROLES)[number];
export const FAST_ROLES = ["planner", "reviewer", "embedder"] as const;
export const SLOW_ROLES = ["coder", "researcher"] as const;

import type { ToolCall, ToolSpec } from "../tools/FileTools.ts";

export type ChatImage = { mime: string; base64: string };

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCall[];
  images?: ChatImage[];
};

export type CompleteOptions = {
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required";
  signal?: AbortSignal;
  onThinking?: (delta: string) => void;
};

export type ChatResult = {
  text: string;
  tokens: number;
  usd: number;
  toolCalls?: ToolCall[];
  thinking?: string;
  model?: string;
  ms?: number;
};
