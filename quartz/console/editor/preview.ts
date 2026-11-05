// Превью заметки: markdown + синтаксис Obsidian ([[ссылки]], ![[вставки]], callouts, ==выделение==).
// Разметка повторяет то, что выдаёт Quartz, поэтому превью оформлено стилями сайта.
import { Marked, type Tokens } from "marked"
import { esc, slugify } from "./util"

export type PreviewCtx = {
  root: URL
  /** имя заметки в нижнем регистре → путь файла */
  notes: Map<string, string>
  /** имя вложения → временный URL (только что загруженные картинки) */
  blobs: Map<string, string>
}

const IMG = /\.(png|jpe?g|gif|webp|avif|svg)$/i

function attachmentUrl(name: string, ctx: PreviewCtx): string {
  const blob = ctx.blobs.get(name)
  if (blob) return blob
  return new URL(`attachments/${name.replace(/\s/g, "-")}`, ctx.root).toString()
}

function noteHref(target: string, ctx: PreviewCtx): { href: string; known: boolean } {
  const name = target.split("/").pop()!.toLowerCase().replace(/\.md$/, "")
  const path = ctx.notes.get(name)
  return {
    href: new URL(slugify(path ?? `${target}.md`), ctx.root).toString(),
    known: !!path,
  }
}

const CALLOUT_ALIASES: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
}

export function createRenderer(ctx: PreviewCtx) {
  const md = new Marked({ gfm: true, breaks: false })

  md.use({
    extensions: [
      {
        name: "wikilink",
        level: "inline",
        start: (src: string) => src.match(/!?\[\[/)?.index,
        tokenizer(src: string) {
          const m = /^(!?)\[\[([^\]|#\n]+)(#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/.exec(src)
          if (!m) return
          return {
            type: "wikilink",
            raw: m[0],
            embed: m[1] === "!",
            target: m[2].trim(),
            anchor: m[3] ?? "",
            alias: m[4]?.trim(),
          }
        },
        renderer(t: any) {
          if (t.embed && IMG.test(t.target)) {
            const w = /^\d+$/.test(t.alias ?? "") ? ` width="${t.alias}"` : ""
            return `<img src="${esc(attachmentUrl(t.target, ctx))}" alt="${esc(t.target)}"${w} loading="lazy">`
          }
          const { href, known } = noteHref(t.target, ctx)
          const label = esc(
            t.alias && !/^\d+$/.test(t.alias) ? t.alias : t.target + (t.anchor ?? ""),
          )
          if (t.embed) {
            return `<blockquote class="kbe-embed"><a class="internal${known ? "" : " broken"}" href="${esc(href)}">↪ ${label}</a></blockquote>`
          }
          return `<a class="internal${known ? "" : " broken"}" href="${esc(href)}">${label}</a>`
        },
      },
      {
        name: "highlight",
        level: "inline",
        start: (src: string) => src.indexOf("=="),
        tokenizer(src: string) {
          const m = /^==(?=\S)([^\n]*?\S)==/.exec(src)
          if (m)
            return {
              type: "highlight",
              raw: m[0],
              text: m[1],
              tokens: this.lexer.inlineTokens(m[1]),
            }
        },
        renderer(t: any) {
          return `<span class="text-highlight">${this.parser.parseInline(t.tokens)}</span>`
        },
      },
    ],
    renderer: {
      code(t: Tokens.Code) {
        const lang = (t.lang ?? "").split(/\s/)[0]
        const title = /title="([^"]+)"/.exec(t.lang ?? "")?.[1]
        const lines = t.text.split("\n").map((l) => `<span data-line>${esc(l) || " "}</span>`)
        return `<figure data-rehype-pretty-code-figure class="code-block"><div class="code-head"><span class="code-lang">${esc(lang)}</span>${title ? `<span class="code-file">${esc(title)}</span>` : ""}</div><pre data-language="${esc(lang)}"><code data-language="${esc(lang)}" style="display:grid">${lines.join("\n")}</code></pre></figure>`
      },
      table(t: Tokens.Table) {
        const head = t.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("")
        const rows = t.rows
          .map(
            (r) =>
              `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`,
          )
          .join("")
        return `<div class="table-container"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
      },
      blockquote(t: Tokens.Blockquote) {
        const inner = this.parser.parse(t.tokens)
        const m = /^<p>\[!([\w-]+)\]([+-]?)[ \t]*([^\n<]*)(?:\n|<\/p>)/.exec(inner)
        if (!m) return `<blockquote>${inner}</blockquote>`
        const type = CALLOUT_ALIASES[m[1].toLowerCase()] ?? m[1].toLowerCase()
        const fold = m[2]
        const title = m[3].trim() || type.charAt(0).toUpperCase() + type.slice(1)
        let rest = inner.slice(m[0].length)
        if (m[0].endsWith("\n")) rest = `<p>${rest}`
        rest = rest.replace(/^<p><\/p>/, "")
        const cls = `callout ${type}${fold ? " is-collapsible" : ""}${fold === "-" ? " is-collapsed" : ""}`
        return `<blockquote class="${cls}" data-callout="${esc(type)}"><div class="callout-title"><div class="callout-icon"></div><div class="callout-title-inner"><p data-type="${esc(type)}">${esc(title)}</p></div>${fold ? '<div class="fold-callout-icon"></div>' : ""}</div><div class="callout-content"${fold === "-" ? ' style="grid-template-rows:0fr"' : ""}>${rest}</div></blockquote>`
      },
    },
  })

  return function render(source: string): string {
    let body = source
    let tagsHtml = ""
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
    if (fm) {
      body = source.slice(fm[0].length)
      const tags =
        /^tags:\s*\[([^\]]*)\]/m.exec(fm[1])?.[1].split(",") ??
        [...fm[1].matchAll(/^\s*-\s+(.+)$/gm)].map((x) => x[1])
      const clean = tags.map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      if (clean.length)
        tagsHtml = `<p class="kbe-tags">${clean.map((x) => `<span class="pill">${esc(x)}</span>`).join("")}</p>`
    }
    const html = md.parse(body, { async: false }) as string
    return `<article class="markdown-rendered">${tagsHtml}${html}</article>`
  }
}
