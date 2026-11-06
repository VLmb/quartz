// Настройка CodeMirror 6: markdown с подсветкой в цветах темы, автодополнение
// [[заметок]], ![[вложений]] и #тегов, горячие клавиши форматирования.
import { EditorState, EditorSelection, type Extension } from "@codemirror/state"
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  placeholder,
  dropCursor,
  rectangularSelection,
} from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from "@codemirror/commands"
import {
  markdownLanguage,
  insertNewlineContinueMarkup,
  deleteMarkupBackward,
} from "@codemirror/lang-markdown"
import {
  HighlightStyle,
  Language,
  LanguageSupport,
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
} from "@codemirror/language"
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { tags as t } from "@lezer/highlight"

export { undo, redo, startCompletion }

// Markdown без «setext»-заголовков: иначе frontmatter (--- … ---) подсвечивается как заголовок.
const obsidianMarkdown = new Language(
  markdownLanguage.data,
  (markdownLanguage.parser as any).configure({ remove: ["SetextHeading"] }),
  [],
  "markdown",
)

export type Sources = {
  notes: () => string[]
  attachments: () => string[]
  tags: () => string[]
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: "cm-h cm-h1" },
  { tag: t.heading2, class: "cm-h cm-h2" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], class: "cm-h cm-h3" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], class: "cm-link" },
  { tag: t.monospace, class: "cm-code" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], class: "cm-meta" },
  { tag: t.quote, class: "cm-quote" },
  { tag: t.list, class: "cm-meta" },
  { tag: t.comment, class: "cm-meta" },
  { tag: [t.keyword, t.atom, t.bool], class: "cm-kw" },
  { tag: [t.string, t.special(t.string)], class: "cm-str" },
  { tag: t.number, class: "cm-num" },
])

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "calc(15px * var(--fs, 1))",
    backgroundColor: "transparent",
    color: "var(--ed-text)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--ed-mono)", lineHeight: "1.7", overflow: "auto" },
  ".cm-content": {
    padding: "20px 0 40vh",
    caretColor: "var(--ed-indicator)",
    maxWidth: "820px",
    margin: "0 auto",
  },
  ".cm-line": { padding: "0 24px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ed-indicator)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--ed-mark) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--ed-hover)" },
  ".cm-placeholder": { color: "var(--ed-faint)" },
  ".cm-tooltip": {
    border: "none",
    backgroundColor: "var(--ed-panel2)",
    borderRadius: "var(--ed-r)",
    boxShadow: "var(--ed-shadow)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--ed-ui)",
    fontSize: "calc(13px * var(--fs, 1))",
    maxHeight: "260px",
  },
  ".cm-tooltip-autocomplete > ul > li": { padding: "6px 10px !important", color: "var(--ed-text)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--ed-active)",
    color: "var(--ed-fg)",
  },
  ".cm-completionDetail": { color: "var(--ed-faint)", fontStyle: "normal", marginLeft: "8px" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--ed-fg)", fontWeight: "600" },
  ".cm-panels": {
    backgroundColor: "var(--ed-panel)",
    color: "var(--ed-text)",
    borderColor: "var(--ed-line)",
  },
  ".cm-panels input, .cm-panels button": { fontFamily: "var(--ed-ui)" },
  ".cm-searchMatch": { backgroundColor: "var(--ed-mark)", outline: "none" },
  ".cm-gutters": { display: "none" },
})

function wikiCompletion(src: Sources) {
  return (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/!?\[\[[^\]\n]*$/)
    if (!m) return null
    const embed = m.text.startsWith("!")
    const from = m.from + (embed ? 3 : 2)
    const list = embed ? src.attachments() : src.notes()
    return {
      from,
      validFor: /^[^\]\n]*$/,
      options: list.map((label) => ({
        label,
        type: embed ? "file" : "text",
        detail: embed ? "вложение" : "",
        apply: (view: EditorView, _c: unknown, f: number, to: number) => {
          const after = view.state.sliceDoc(to, to + 2)
          const insert = label + (after === "]]" ? "" : "]]")
          view.dispatch({
            changes: { from: f, to, insert },
            selection: { anchor: f + label.length + 2 - (after === "]]" ? 0 : 0) },
          })
        },
      })),
    }
  }
}

function tagCompletion(src: Sources) {
  return (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/(^|[\s(])#[\p{L}\p{N}_/-]*$/u)
    if (!m) return null
    const hash = m.text.indexOf("#")
    const line = ctx.state.doc.lineAt(ctx.pos)
    if (/^#+\s/.test(line.text)) return null // заголовок, а не тег
    if (m.text.length - hash < 2 && !ctx.explicit) return null
    return {
      from: m.from + hash + 1,
      validFor: /^[\p{L}\p{N}_/-]*$/u,
      options: src.tags().map((label) => ({ label, type: "keyword", detail: "тег" })),
    }
  }
}

/** Обернуть выделение маркерами (**, *, `, ==); повторное нажатие снимает. */
export function wrap(view: EditorView, mark: string, placeholderText = "текст") {
  const { state } = view
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to)
      const before = state.sliceDoc(r.from - mark.length, r.from)
      const after = state.sliceDoc(r.to, r.to + mark.length)
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: r.from - mark.length, to: r.from },
            { from: r.to, to: r.to + mark.length },
          ],
          range: EditorSelection.range(r.from - mark.length, r.to - mark.length),
        }
      }
      const body = text || placeholderText
      return {
        changes: { from: r.from, to: r.to, insert: mark + body + mark },
        range: EditorSelection.range(r.from + mark.length, r.from + mark.length + body.length),
      }
    }),
  )
  view.focus()
  return true
}

/** Префикс в начале каждой выделенной строки (списки, цитаты); повторно — снять. */
export function linePrefix(view: EditorView, prefix: string | ((i: number) => string)) {
  const { state } = view
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++)
      lines.add(l)
  }
  const nums = [...lines].sort((a, b) => a - b)
  const first = typeof prefix === "string" ? prefix : prefix(0)
  const re = typeof prefix === "string" ? null : /^\d+\.\s/
  const all = nums.every((n) => {
    const tx = state.doc.line(n).text
    return re ? re.test(tx) : tx.startsWith(first)
  })
  const changes = nums.map((n, i) => {
    const line = state.doc.line(n)
    if (all) {
      const len = re ? (re.exec(line.text)?.[0].length ?? 0) : first.length
      return { from: line.from, to: line.from + len }
    }
    const p = typeof prefix === "string" ? prefix : prefix(i)
    return { from: line.from, insert: p }
  })
  view.dispatch({ changes })
  view.focus()
  return true
}

/** Заголовок: ## → ### → обычный текст. */
export function cycleHeading(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = /^(#{1,6})\s/.exec(line.text)
  const cur = m ? m[1].length : 0
  const next = cur === 0 ? 2 : cur === 2 ? 3 : 0
  view.dispatch({
    changes: {
      from: line.from,
      to: line.from + (m ? m[0].length : 0),
      insert: next ? "#".repeat(next) + " " : "",
    },
  })
  view.focus()
  return true
}

export function insertBlock(view: EditorView, text: string, cursorOffset?: number) {
  const { state } = view
  const r = state.selection.main
  const line = state.doc.lineAt(r.from)
  const needNl = line.text.trim() ? "\n\n" : ""
  const insert = needNl + text
  const at = line.text.trim() ? line.to : r.from
  view.dispatch({
    changes: { from: at, to: line.text.trim() ? at : r.to, insert },
    selection: { anchor: at + needNl.length + (cursorOffset ?? text.length) },
    scrollIntoView: true,
  })
  view.focus()
  return true
}

export function insertText(view: EditorView, text: string) {
  const r = view.state.selection.main
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + text.length },
  })
  view.focus()
}

export function createEditor(opts: {
  parent: HTMLElement
  doc: string
  sources: Sources
  onChange: (doc: string) => void
  onSave: () => void
  onPasteFiles: (files: File[], pos: number) => void
  onCursor?: (line: number, col: number) => void
  extraKeys?: { key: string; run: (v: EditorView) => boolean }[]
}): EditorView {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    placeholder("Начните писать… [[ — ссылка на заметку, # — тег, Ctrl+V — вставить картинку"),
    // язык markdown без встроенного HTML/JS — так бандл меньше на ~100 КБ
    new LanguageSupport(obsidianMarkdown),
    syntaxHighlighting(highlight),
    theme,
    autocompletion({
      override: [wikiCompletion(opts.sources), tagCompletion(opts.sources)],
      icons: false,
      activateOnTyping: true,
    }),
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", '"', "`"] } }]),
    keymap.of([
      { key: "Enter", run: insertNewlineContinueMarkup }, // продолжать списки и цитаты
      { key: "Backspace", run: deleteMarkupBackward },
      { key: "Mod-b", run: (v) => wrap(v, "**") },
      { key: "Mod-i", run: (v) => wrap(v, "*") },
      { key: "Mod-Shift-h", run: (v) => wrap(v, "==") },
      { key: "Mod-e", run: (v) => wrap(v, "`", "код") },
      {
        key: "Mod-k",
        run: (v) => {
          insertText(v, "[[")
          startCompletion(v)
          return true
        },
      },
      ...(opts.extraKeys ?? []),
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString())
      if (u.selectionSet || u.docChanged) {
        const head = u.state.selection.main.head
        const line = u.state.doc.lineAt(head)
        opts.onCursor?.(line.number, head - line.from + 1)
      }
    }),
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"))
        if (!files.length) return false
        e.preventDefault()
        opts.onPasteFiles(files, view.state.selection.main.head)
        return true
      },
      drop(e, view) {
        const files = [...(e.dataTransfer?.files ?? [])].filter((f) =>
          /^(image\/|application\/pdf)/.test(f.type),
        )
        if (!files.length) return false
        e.preventDefault()
        const pos =
          view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
        opts.onPasteFiles(files, pos)
        return true
      },
    }),
    EditorView.contentAttributes.of({
      spellcheck: "true",
      autocapitalize: "sentences",
      lang: "ru",
    }),
  ]
  return new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.doc, extensions }),
  })
}
