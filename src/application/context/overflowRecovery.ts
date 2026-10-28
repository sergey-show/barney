/**
 * Detect provider context overflow / output-length failures for compact-and-retry.
 */

export function isContextOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /context[_\s-]?length|maximum context|context window|too many tokens|prompt is too long|token limit|413|resource_exhausted|context_length_exceeded/i.test(msg);
}

export function isOutputLengthFinish(finishReason?: string | null): boolean {
  if (!finishReason) return false;
  return /length|max_tokens|max_output/i.test(finishReason);
}
