import { readFileSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import { PAGES } from "./nav";

export interface Doc {
  slug: string;
  title: string;
  description: string;
  html: string;
  toc: { id: string; text: string }[];
  raw: string;
}

/** Marked escapes heading text; the table of contents renders it as plain text, so undo that. */
const unescape = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const slugify = (s: string) =>
  unescape(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function loadDoc(slug: string): Doc | null {
  if (!PAGES.some((p) => p.slug === slug)) return null;
  const raw = readFileSync(path.join(process.cwd(), "src/docs", `${slug}.md`), "utf8");
  const lines = raw.split("\n");
  const title = lines[0].replace(/^#\s*/, "").trim();
  const description = (lines[1] ?? "").replace(/^>\s*/, "").trim();
  const body = lines.slice(2).join("\n");

  const toc: Doc["toc"] = [];
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth === 2) toc.push({ id, text: unescape(text) });
        return `<h${depth} id="${id}"><a href="#${id}" class="anchor" aria-hidden="true">#</a>${text}</h${depth}>`;
      },
      link({ href, title: t, tokens }) {
        const text = this.parser.parseInline(tokens);
        const ext = /^https?:\/\//.test(href);
        return `<a href="${href}"${t ? ` title="${t}"` : ""}${ext ? ' target="_blank" rel="noreferrer"' : ""}>${text}</a>`;
      },
      table(token) {
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
        return `<div class="doc-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  const html = md.parse(body, { async: false }) as string;
  return { slug, title, description, html, toc, raw };
}

export const allDocs = () => PAGES.map((p) => loadDoc(p.slug)!).filter(Boolean);
