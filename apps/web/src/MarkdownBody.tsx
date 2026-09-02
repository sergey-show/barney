import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "./LocaleContext.tsx";
import { sanitizeMermaid } from "./mermaidSanitize.ts";
import { prepareAssistantReply } from "./replyPresent.ts";

const MERMAID_LANGS = new Set([
  "mermaid",
  "flowchart",
  "graph",
  "sequence",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "erdiagram",
  "mindmap",
  "timeline",
  "gitgraph",
  "pie",
  "journey",
]);

const MERMAID_START = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|mindmap|timeline|gitGraph|pie|journey)\b/;

export function MarkdownBody(props: { text: string }) {
  const { t } = useLocale();
  const prepared = prepareAssistantReply(props.text);
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {prepared.body}
      </ReactMarkdown>
      {prepared.sources.length ? (
        <nav className="md-sources" aria-label={t.replySources}>
          <div className="md-sources-label">{t.replySources}</div>
          <ul className="md-sources-list">
            {prepared.sources.map((source) => (
              <li key={source.href}>
                <a className="md-source" href={source.href} target="_blank" rel="noreferrer">
                  <span className="md-source-host">{source.host}</span>
                  <span className="md-source-title">{source.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

const components = {
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const lang = /language-([\w-]+)/.exec(className ?? "")?.[1]?.toLowerCase() ?? "";
    const source = String(children).replace(/\n$/, "");
    const block = Boolean(className) || source.includes("\n");
    if (!block) return <code>{children}</code>;
    if (lang === "canvas") return <CanvasBlock source={source} />;
    if (MERMAID_LANGS.has(lang) || MERMAID_START.test(source.trim())) {
      return <MermaidBlock source={normalizeMermaid(lang, source)} />;
    }
    return (
      <pre className="md-pre">
        {lang ? <div className="md-pre-lang">{lang}</div> : null}
        <code>{source}</code>
      </pre>
    );
  },
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
    return safe ? (
      <a className="md-link" href={safe} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  img: ({ src, alt }: { src?: string; alt?: string }) => {
    if (!src || !(/^https?:\/\//i.test(src) || src.startsWith("/api/sessions/"))) return null;
    return <img src={src} alt={alt ?? ""} />;
  },
};

function CanvasBlock(props: { source: string }) {
  const trimmed = props.source.trim();
  return (
    <div className="md-canvas">
      <div className="md-canvas-label">canvas</div>
      {MERMAID_START.test(trimmed) ? (
        <MermaidBlock source={normalizeMermaid("", trimmed)} />
      ) : (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {props.source}
        </ReactMarkdown>
      )}
    </div>
  );
}

function MermaidBlock(props: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, "");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
    if (host.current) host.current.innerHTML = "";
    void getMermaid()
      .then((mermaid) => renderMermaid(mermaid, id, props.source))
      .then((svg) => {
        if (cancelled || !host.current) return;
        host.current.innerHTML = svg;
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [props.source, reactId]);

  return (
    <div className="md-mermaid-wrap">
      {error ? (
        <pre className="md-pre">
          <div className="md-pre-lang">mermaid · {error}</div>
          <code>{props.source}</code>
        </pre>
      ) : (
        <div className="md-mermaid" ref={host} />
      )}
    </div>
  );
}

function normalizeMermaid(lang: string, source: string): string {
  const trimmed = source.trim();
  if (MERMAID_START.test(trimmed)) return trimmed;
  if (lang === "flowchart" || lang === "graph") return `flowchart TD\n${trimmed}`;
  if (lang === "sequence" || lang === "sequencediagram") return `sequenceDiagram\n${trimmed}`;
  return trimmed;
}

async function renderMermaid(mermaid: MermaidApi, id: string, source: string): Promise<string> {
  const attempts = [sanitizeMermaid(source), source].filter((item, index, all) => all.indexOf(item) === index);
  let last: unknown;
  for (const [index, text] of attempts.entries()) {
    try {
      const { svg } = await mermaid.render(`${id}-${index}`, text);
      if (/syntax error/i.test(svg)) {
        last = new Error("syntax error");
        continue;
      }
      return svg;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

let mermaidReady: Promise<MermaidApi> | null = null;

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

function getMermaid() {
  const url = new URL("/vendor/mermaid/mermaid.esm.min.mjs", document.baseURI).href;
  mermaidReady ??= import(/* @vite-ignore */ url).then((mod: { default?: MermaidApi }) => {
    const mermaid = mod.default ?? (mod as unknown as MermaidApi);
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "strict",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        background: "#161616",
        primaryColor: "#2a2a3a",
        primaryTextColor: "#e8e8e8",
        primaryBorderColor: "#5a5a7a",
        lineColor: "#8f8f8f",
        secondaryColor: "#222",
        tertiaryColor: "#1a1a1a",
      },
    });
    return mermaid;
  });
  return mermaidReady;
}
