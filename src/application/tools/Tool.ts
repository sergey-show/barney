
import type { ToolSpec } from "../../domain/tools/FileTools.ts";

export type ToolMetadata = {
  title?: string;
  [key: string]: unknown;
};

export type ToolResult = {
  output: string;
  /** Rich side-channel for UI, snapshots, diagnostics — not model-facing by default. */
  metadata?: ToolMetadata;
};

export type ToolDefinition = ToolSpec & {
  /** Stable id; defaults to name. Sanitized for provider SDKs (`.` → `_`). */
  id?: string;
};

export function defineTool(input: ToolDefinition): ToolDefinition {
  return {
    ...input,
    id: (input.id ?? input.name).replaceAll(".", "_"),
  };
}

export function toolResult(output: string, metadata?: ToolMetadata): ToolResult {
  return metadata ? { output, metadata } : { output };
}

export function toToolSpec(def: ToolDefinition): ToolSpec {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  };
}
