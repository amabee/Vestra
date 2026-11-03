import { createElement, Fragment, useMemo, type ReactNode } from "react";
import { bridge } from "@/lib/bridge";

const allowed = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "code",
  "pre",
  "blockquote",
  "br",
  "hr",
  "del",
]);
const blocked = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "svg",
  "math",
  "img",
  "picture",
  "video",
  "audio",
  "source",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "noscript",
]);

/** Updater notes are remote HTML. Rebuild an allowlisted React tree, never mount it. */
function renderNotes(notes: string): ReactNode {
  // Template contents stay inert, including image and frame resource loading.
  const template = document.createElement("template");
  template.innerHTML = notes.slice(0, 6000);
  let remaining = 2000;
  const render = (
    node: Node,
    key: number,
    depth: number,
    pre = false,
  ): ReactNode => {
    if (--remaining < 0 || depth > 20) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return pre || node.textContent?.trim() ? node.textContent : null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node as Element;
    const tag = element.localName;
    if (
      element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      blocked.has(tag)
    )
      return null;
    const children = Array.from(element.childNodes).map((child, index) =>
      render(child, index, depth + 1, pre || tag === "pre"),
    );
    if (tag === "a") {
      try {
        const href = element.getAttribute("href");
        if (href) {
          const url = new URL(href, "https://github.com/amabee/Vestra/");
          if (url.protocol === "https:" && !url.username && !url.password) {
            return (
              <a
                key={key}
                href={url.href}
                className="link"
                rel="noopener noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void bridge.shell
                    .openExternal(url.href)
                    .catch(() => undefined);
                }}
              >
                {children}
              </a>
            );
          }
        }
      } catch {
        /* An invalid link keeps its readable label. */
      }
    }
    return allowed.has(tag) ? (
      createElement(
        tag,
        { key },
        tag === "br" || tag === "hr" ? undefined : children,
      )
    ) : (
      <Fragment key={key}>{children}</Fragment>
    );
  };
  return Array.from(template.content.childNodes).map((node, index) =>
    render(node, index, 0),
  );
}

export function ReleaseNotes({ notes }: { notes: string }) {
  const content = useMemo(() => renderNotes(notes), [notes]);
  return (
    <div
      aria-label="Release notes"
      className="mt-3 space-y-3 whitespace-pre-wrap break-words text-base-content/60 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-field [&_pre]:bg-base-200 [&_pre]:p-3 [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-base-content/20 [&_blockquote]:pl-3"
    >
      {content}
    </div>
  );
}
