import { pageCodeIdents, replyOmitsPageCode } from "../research/verifyReply.ts";

export function sealReply(
  text: string,
  input: { goalAnchors?: string[]; pageEvidence?: string; goal?: string },
): string {
  let out = (text ?? "").trim();
  for (const anchor of input.goalAnchors ?? []) {
    if (!/^https?:\/\//i.test(anchor)) continue;
    const bare = anchor.replace(/\/+$/, "");
    if (out.includes(anchor) || out.includes(bare)) continue;
    out = out ? `${out}\n\n${anchor}` : anchor;
  }
  const pages = input.pageEvidence ?? "";
  const miss = pages && input.goal ? replyOmitsPageCode(out, pages, input.goal) : undefined;
  if (miss) {
    const api = pageCodeIdents(pages).find((id) => !out.includes(id));
    if (api) out = out ? `${out}\n\n\`${api}\`` : `\`${api}\``;
  }
  return out;
}
