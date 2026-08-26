import { useEffect, useRef } from "react";
import { htmlToMd, mdToHtml } from "./mdPreview.ts";

export function MarkdownEditor(props: {
  id?: string;
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = mdToHtml(props.value).trim() || "<p><br></p>";
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // ignore: not all engines support it
    }
  }, []);

  return (
    <div
      ref={host}
      id={props.id}
      className={`md md-editor${props.readOnly ? " is-readonly" : ""}`}
      contentEditable={!props.readOnly}
      role="textbox"
      aria-multiline="true"
      aria-readonly={props.readOnly || undefined}
      data-placeholder={props.placeholder}
      suppressContentEditableWarning
      onInput={() => {
        const el = host.current;
        if (!el || props.readOnly) return;
        promoteBlock(el);
        props.onChange(htmlToMd(el));
      }}
      onPaste={(event) => {
        if (props.readOnly) return;
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        if (/^#{1,6}\s|^\s*[-*]\s|\*\*/m.test(text) && text.includes("\n")) {
          document.execCommand("insertHTML", false, mdToHtml(text) || escapeInsert(text));
        } else {
          document.execCommand("insertText", false, text);
        }
      }}
    />
  );
}

function promoteBlock(host: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  let block = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement ?? null;
  while (block && block !== host && !/^(P|DIV|LI|H[1-6])$/.test(block.tagName)) {
    block = block.parentElement;
  }
  if (!block || block === host) return;
  const raw = (block.textContent ?? "").replace(/\u00a0/g, " ");
  const heading = /^(#{1,6}) (.*)$/.exec(raw);
  if (heading && /^(P|DIV)$/.test(block.tagName)) {
    const node = document.createElement(`h${heading[1].length}`);
    node.textContent = heading[2];
    block.replaceWith(node);
    caretEnd(node);
    return;
  }
  const item = /^[-*] (.*)$/.exec(raw);
  if (item && /^(P|DIV)$/.test(block.tagName)) {
    const ul = document.createElement("ul");
    const li = document.createElement("li");
    li.textContent = item[1];
    ul.appendChild(li);
    block.replaceWith(ul);
    caretEnd(li);
  }
}

function caretEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function escapeInsert(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
