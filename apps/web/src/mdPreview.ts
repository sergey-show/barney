import { marked } from "marked";

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html() {
      return "";
    },
    image() {
      return "";
    },
    link({ href, text }) {
      const label = escapeHtml(text);
      if (href && /^https?:\/\//i.test(href)) {
        return `<a href="${escapeAttr(href)}">${label}</a>`;
      }
      return label;
    },
  },
});

export function mdToHtml(md: string): string {
  const src = md.trim();
  if (!src) return "";
  return String(marked.parse(src, { async: false }));
}

export function htmlToMd(root: ParentNode): string {
  const parts = Array.from(root.childNodes).map((node) => blockToMd(node)).filter((part) => part !== null);
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function plainPreview(md: string, n = 120): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function blockToMd(node: Node): string | null {
  if (node.nodeType === 3) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    return text || null;
  }
  if (node.nodeType !== 1) return null;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return "";
  if (tag === "hr") return "---";
  if (/^h[1-6]$/.test(tag)) {
    const depth = Number(tag[1]);
    return `${"#".repeat(depth)} ${inlineToMd(el).trim()}`;
  }
  if (tag === "pre") return `\`\`\`\n${(el.textContent ?? "").replace(/\n$/, "")}\n\`\`\``;
  if (tag === "blockquote") {
    const inner = htmlToMd(el) || inlineToMd(el);
    return inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
  }
  if (tag === "ul") {
    return Array.from(el.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((li) => listItemToMd(li as HTMLElement, "-"))
      .join("\n");
  }
  if (tag === "ol") {
    return Array.from(el.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((li, index) => listItemToMd(li as HTMLElement, `${index + 1}.`))
      .join("\n");
  }
  if (tag === "li") return listItemToMd(el, "-");
  if (tag === "p" || tag === "div") {
    if (hasBlockChild(el)) return htmlToMd(el);
    const inline = inlineToMd(el).trim();
    return inline || null;
  }
  const inline = inlineToMd(el).trim();
  return inline || null;
}

function listItemToMd(li: HTMLElement, mark: string): string {
  const nested: HTMLElement[] = [];
  const headBits: string[] = [];
  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === 1) {
      const tag = (child as HTMLElement).tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        nested.push(child as HTMLElement);
        continue;
      }
    }
    headBits.push(inlinePiece(child));
  }
  const head = headBits.join("").trim();
  const kids = nested.map((child) => indent(blockToMd(child) || "")).filter(Boolean);
  return [`${mark} ${head}`.trimEnd(), ...kids].join("\n");
}

function inlineToMd(node: Node): string {
  return Array.from(node.childNodes).map((child) => inlinePiece(child)).join("");
}

function inlinePiece(node: Node): string {
  if (node.nodeType === 3) return escapeMd((node.textContent ?? "").replace(/\u00a0/g, " "));
  if (node.nodeType !== 1) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${inlineToMd(el)}**`;
  if (tag === "em" || tag === "i") return `*${inlineToMd(el)}*`;
  if (tag === "code") return `\`${(el.textContent ?? "").replace(/`/g, "\\`")}\``;
  if (tag === "del" || tag === "s") return `~~${inlineToMd(el)}~~`;
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    const label = inlineToMd(el) || href;
    return href && /^https?:\/\//i.test(href) ? `[${label}](${href})` : label;
  }
  return inlineToMd(el);
}

function hasBlockChild(el: HTMLElement): boolean {
  return Array.from(el.children).some((child) => /^(UL|OL|PRE|BLOCKQUOTE|H[1-6]|P|DIV)$/.test(child.tagName));
}

function indent(text: string): string {
  return text.split("\n").map((line) => (line ? `  ${line}` : line)).join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeMd(value: string): string {
  return value.replace(/([\\`*_[\]#])/g, "\\$1");
}
