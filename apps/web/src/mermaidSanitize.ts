const SPECIAL = /[()<>/#:]|<br/i;

export function sanitizeMermaid(source: string): string {
  let out = source.replace(/<br\s*\/?>/gi, "<br>");
  out = quoteRects(out);
  out = quoteCircles(out);
  out = quoteRounds(out);
  out = quoteDiamonds(out);
  out = quoteEdges(out);
  return out;
}

function quoteRects(src: string): string {
  return src.replace(/\b([A-Za-z][\w-]*)\[(?!")([^\]]*)\]/g, (_, id: string, label: string) =>
    wrap(id, "[", label, "]"),
  );
}

function quoteCircles(src: string): string {
  return src.replace(/\b([A-Za-z][\w-]*)\(\((?!")([^)]*)\)\)/g, (_, id: string, label: string) =>
    wrap(id, "((", label, "))"),
  );
}

function quoteRounds(src: string): string {
  return src.replace(/\b([A-Za-z][\w-]*)\((?!\()(?!")([^)]*)\)/g, (_, id: string, label: string) =>
    wrap(id, "(", label, ")"),
  );
}

function quoteDiamonds(src: string): string {
  return src.replace(/\b([A-Za-z][\w-]*)\{(?!")([^{}]*)\}/g, (_, id: string, label: string) =>
    wrap(id, "{", label, "}"),
  );
}

function quoteEdges(src: string): string {
  return src.replace(/\|(?!")([^|\n]+)\|/g, (_, label: string) =>
    SPECIAL.test(label) ? `|"${esc(label)}"|` : `|${label}|`,
  );
}

function wrap(id: string, open: string, label: string, close: string): string {
  return SPECIAL.test(label) ? `${id}${open}"${esc(label)}"${close}` : `${id}${open}${label}${close}`;
}

function esc(label: string): string {
  return label.replace(/"/g, "#quot;");
}
