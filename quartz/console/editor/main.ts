// Редактор заметок прямо на сайте. Подгружается лениво (отдельный бандл),
// работает через kb-api: чтение и сохранение файлов — коммиты в репозиторий заметок.
import type { EditorView } from "@codemirror/view"
import { api, ApiError, setApiBase, type Tree } from "./api"
import {
  createEditor,
  cycleHeading,
  insertBlock,
  insertText,
  linePrefix,
  redo,
  startCompletion,
  undo,
  wrap,
} from "./cm"
import { createRenderer, type PreviewCtx } from "./preview"
import { iconString } from "../iconPaths"
import {
  ago,
  checkNotePath,
  dirOf,
  el,
  esc,
  extFor,
  lineDiff,
  shrinkImage,
  slugify,
  store,
  titleOf,
  today,
} from "./util"

type Entry = { slug: string; title: string; tags: string[]; filePath?: string }
export type Host = {
  root: string
  entries: () => Promise<Entry[]>
}

let host: Host
let tree: Tree | null = null
let treeLoading: Promise<Tree> | null = null
const blobs = new Map<string, string>()
let current: Session | null = null

const icon = (n: string) => iconString(n)

export function init(h: Host) {
  host = h
  setApiBase(h.root)
  ensureToasts()
}

function rootUrl() {
  return new URL(host.root, location.href)
}

function loadTree(force = false): Promise<Tree> {
  if (!treeLoading || force) {
    treeLoading = api
      .tree()
      .then((t) => (tree = t))
      .catch(() => (tree = tree ?? { dirs: [], notes: [], attachments: [] }))
  }
  return treeLoading
}

/* ───────────── всплывающие сообщения ───────────── */

let toastBox: HTMLElement | null = null
function ensureToasts() {
  if (!toastBox) toastBox = el("div", { class: "kbe-toasts", "aria-live": "polite" })
  if (!toastBox.isConnected) document.body.append(toastBox)
}

type ToastAction = { label: string; run: () => void; primary?: boolean }
type Toast = {
  update: (html: string, opts?: { kind?: string; actions?: ToastAction[]; spin?: boolean }) => void
  close: () => void
}

export function toast(
  html: string,
  opts: {
    kind?: "info" | "ok" | "error"
    actions?: ToastAction[]
    timeout?: number
    spin?: boolean
  } = {},
): Toast {
  ensureToasts()
  const node = el("div", { class: "kbe-toast", role: "status" })
  let timer = 0
  const close = () => {
    clearTimeout(timer)
    node.classList.add("out")
    setTimeout(() => node.remove(), 200)
  }
  const update: Toast["update"] = (h, o = {}) => {
    node.dataset.kind = o.kind ?? opts.kind ?? "info"
    node.innerHTML = ""
    if (o.spin) node.append(el("span", { class: "kbe-spin" }))
    node.append(el("span", { class: "kbe-toast-t", html: h }))
    for (const a of o.actions ?? []) {
      const b = el(
        "button",
        { type: "button", class: a.primary ? "kbe-btn sm primary" : "kbe-btn sm" },
        a.label,
      )
      b.onclick = () => {
        a.run()
        close()
      }
      node.append(b)
    }
    const x = el("button", {
      type: "button",
      class: "kbe-x",
      "aria-label": "Закрыть",
      html: icon("x"),
    })
    x.onclick = close
    node.append(x)
  }
  update(html, { actions: opts.actions, spin: opts.spin })
  toastBox!.append(node)
  if (opts.timeout) timer = window.setTimeout(close, opts.timeout)
  return { update, close }
}

/* ───────────── диалоги ───────────── */

type DialogAction = { label: string; value: string; kind?: "primary" | "danger" | "ghost" }

function dialog(
  title: string,
  body: Node | string,
  actions: DialogAction[],
  focusSel?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const back = el("div", { class: "kbe-modal-back" })
    const box = el("div", {
      class: "kbe-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
    })
    const content =
      typeof body === "string" ? el("p", { class: "kbe-modal-text", html: body }) : body
    const foot = el("div", { class: "kbe-modal-foot" })
    const done = (v: string | null) => {
      document.removeEventListener("keydown", onKey, true)
      back.remove()
      resolve(v)
    }
    for (const a of actions) {
      const b = el("button", { type: "button", class: `kbe-btn ${a.kind ?? ""}` }, a.label)
      b.onclick = () => done(a.value)
      foot.append(b)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        done(null)
      }
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
        e.preventDefault()
        const primary = actions.find((a) => a.kind === "primary")
        if (primary) done(primary.value)
      }
    }
    document.addEventListener("keydown", onKey, true)
    back.onclick = (e) => e.target === back && done(null)
    box.append(el("h2", { class: "kbe-modal-h" }, title), content, foot)
    back.append(box)
    document.body.append(back)
    setTimeout(
      () => (box.querySelector<HTMLElement>(focusSel ?? "input, .primary") ?? box).focus(),
      30,
    )
  })
}

const alertBox = (title: string, text: string) =>
  dialog(title, text, [{ label: "Понятно", value: "ok", kind: "primary" }])

/* ───────────── публикация ───────────── */

/**
 * Следим только за последней публикацией: новая сборка включает все прошлые правки,
 * а GitHub отменяет устаревшие сборки (concurrency) — их «cancelled» не ошибка.
 */
let activeDeploy: { id: number; toast: Toast } | null = null
let deploySeq = 0

function trackDeploy(commit: string, what: string, opts: { open?: string; home?: boolean } = {}) {
  activeDeploy?.toast.close()
  const id = ++deploySeq
  const t = toast(`Публикую ${what}…`, { spin: true })
  activeDeploy = { id, toast: t }
  const started = Date.now()
  const tick = async () => {
    if (activeDeploy?.id !== id) return
    if (Date.now() - started > 10 * 60_000) {
      t.update(`Публикация ${what} идёт дольше обычного — проверьте GitHub Actions.`, {
        kind: "error",
      })
      return
    }
    try {
      const s = await api.deploy(commit)
      if (s.status === "completed") {
        if (activeDeploy?.id === id) activeDeploy = null
        if (s.conclusion === "cancelled") {
          t.close()
          return
        }
        if (s.conclusion === "success") {
          const actions: ToastAction[] = []
          if (opts.open) {
            const target = new URL(opts.open, rootUrl())
            const same = target.pathname === location.pathname
            actions.push({
              label: same ? "Обновить" : "Открыть",
              primary: true,
              run: () => (location.href = target.toString()),
            })
          } else if (opts.home) {
            actions.push({
              label: "На главную",
              primary: true,
              run: () => (location.href = rootUrl().toString()),
            })
          }
          t.update(`${what.charAt(0).toUpperCase()}${what.slice(1)} — опубликовано`, {
            kind: "ok",
            actions,
          })
        } else {
          t.update(
            `Сборка сайта не удалась (${esc(s.conclusion ?? "ошибка")}). Изменения сохранены в репозитории.`,
            {
              kind: "error",
              actions: s.url
                ? [{ label: "Открыть лог", run: () => window.open(s.url!, "_blank") }]
                : [],
            },
          )
        }
        return
      }
      setTimeout(tick, 4000)
    } catch {
      setTimeout(tick, 8000)
    }
  }
  setTimeout(tick, 3000)
}

/* ───────────── сессия редактирования ───────────── */

type Draft = { content: string; base: string | null; ts: number }
const draftKey = (path: string) => `kb-draft:${path}`

class Session {
  path: string
  sha: string | null
  isNew: boolean
  saved: string
  htmlUrl?: string
  view!: EditorView
  root!: HTMLElement
  statusEl!: HTMLElement
  titleEl!: HTMLElement
  dirEl!: HTMLElement
  banner!: HTMLElement
  previewEl!: HTMLElement
  footEl!: HTMLElement
  saving = false
  previewMode: "preview" | "diff" = "preview"
  renderTimer = 0
  draftTimer = 0
  render!: (src: string) => string
  pushedHistory = false

  constructor(opts: {
    path: string
    sha: string | null
    content: string
    isNew: boolean
    htmlUrl?: string
  }) {
    this.path = opts.path
    this.sha = opts.sha
    this.isNew = opts.isNew
    this.saved = opts.isNew ? "" : opts.content
    this.htmlUrl = opts.htmlUrl
    this.build(opts.content)
  }

  get dirty() {
    return this.isNew || this.view.state.doc.toString() !== this.saved
  }

  /* ── разметка окна ── */
  build(doc: string) {
    const btn = (cls: string, html: string, title: string, run: () => void) => {
      const b = el("button", { type: "button", class: cls, title, "aria-label": title, html })
      b.addEventListener("mousedown", (e) => e.preventDefault()) // не терять фокус и клавиатуру
      b.onclick = run
      return b
    }
    this.root = el("div", { class: "kbe", role: "dialog", "aria-label": "Редактор заметки" })
    this.dirEl = el("span", { class: "kbe-dir" })
    this.titleEl = el("b", { class: "kbe-title-t" })
    const titleBtn = btn("kbe-title", "", "Переименовать или перенести", () => this.rename())
    titleBtn.append(this.dirEl, this.titleEl)
    this.statusEl = el("span", { class: "kbe-status" })
    const seg = el("div", { class: "kbe-seg" })
    const segText = btn("on", "Текст", "Текст", () => this.setMobileTab("text"))
    const segPrev = btn("", "Превью", "Превью", () => this.setMobileTab("preview"))
    seg.append(segText, segPrev)
    const head = el(
      "header",
      { class: "kbe-head" },
      btn("kbe-icon", icon("arrowLeft"), "Закрыть (Esc)", () => this.close()),
      titleBtn,
      this.statusEl,
      el("span", { class: "kbe-sp" }),
      seg,
      btn("kbe-icon kbe-d", icon("eye"), "Показать или скрыть превью", () =>
        this.root.classList.toggle("no-preview"),
      ),
      btn("kbe-icon", icon("more"), "Ещё", () => this.menu()),
      btn("kbe-btn primary kbe-save", `<span>Сохранить</span>`, "Сохранить (Ctrl+S)", () =>
        this.save(),
      ),
    )

    const tools: [string, string, () => void][] = [
      ["H", "Заголовок: ## → ### → текст", () => cycleHeading(this.view)],
      ["<b>B</b>", "Жирный (Ctrl+B)", () => wrap(this.view, "**")],
      ["<i>I</i>", "Курсив (Ctrl+I)", () => wrap(this.view, "*")],
      ["<s>S</s>", "Зачёркнутый", () => wrap(this.view, "~~")],
      ["<mark>H</mark>", "Выделение ==текст== (Ctrl+Shift+H)", () => wrap(this.view, "==")],
      ["|", "", () => {}],
      [icon("list"), "Список", () => linePrefix(this.view, "- ")],
      [
        icon("listOrdered"),
        "Нумерованный список",
        () => linePrefix(this.view, (i) => `${i + 1}. `),
      ],
      [icon("checkSquare"), "Задачи", () => linePrefix(this.view, "- [ ] ")],
      [icon("quote"), "Цитата", () => linePrefix(this.view, "> ")],
      ["|", "", () => {}],
      [
        icon("link"),
        "Ссылка на заметку [[ ]] (Ctrl+K)",
        () => (insertText(this.view, "[["), startCompletion(this.view)),
      ],
      [icon("image"), "Картинка: файл, фото или скриншот", () => this.pickFiles()],
      [icon("code"), "Код (Ctrl+E — в строке)", () => this.codeBlock()],
      [icon("callout"), "Callout: вопрос, совет, предупреждение", () => this.calloutMenu()],
      [
        icon("table"),
        "Таблица",
        () => insertBlock(this.view, "| Колонка | Колонка |\n| --- | --- |\n|  |  |\n", 2),
      ],
      [icon("minus"), "Разделитель", () => insertBlock(this.view, "---\n")],
      ["|", "", () => {}],
      [icon("undo"), "Отменить (Ctrl+Z)", () => undo(this.view)],
      [icon("redo"), "Повторить (Ctrl+Shift+Z)", () => redo(this.view)],
    ]
    const toolbar = el("div", { class: "kbe-tools", role: "toolbar" })
    for (const [html, title, run] of tools) {
      toolbar.append(
        html === "|" ? el("span", { class: "kbe-sep" }) : btn("kbe-tool", html, title, run),
      )
    }

    this.banner = el("div", { class: "kbe-banner", hidden: true })
    const editorPane = el("div", { class: "kbe-pane kbe-edit" })
    this.previewEl = el("div", { class: "kbe-pane kbe-preview prose" })
    this.footEl = el("footer", { class: "kbe-foot" })
    this.root.append(
      head,
      toolbar,
      this.banner,
      el("div", { class: "kbe-body" }, editorPane, this.previewEl),
      this.footEl,
    )
    if (store.get<boolean>("kb-editor-nopreview")) this.root.classList.add("no-preview")

    document.addEventListener("keydown", this.onKey, true)
    this.previewEl.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a")
      if (a) {
        e.preventDefault()
        toast(`Ссылка ведёт на «${esc(a.textContent ?? "")}»`, { timeout: 2500 })
        return
      }
      const title = (e.target as HTMLElement).closest(".callout.is-collapsible > .callout-title")
      if (title) {
        const c = title.parentElement!
        c.classList.toggle("is-collapsed")
        const content = c.querySelector<HTMLElement>(".callout-content")
        if (content)
          content.style.gridTemplateRows = c.classList.contains("is-collapsed") ? "0fr" : "1fr"
      }
    })

    this.render = createRenderer(this.previewCtx())
    this.view = createEditor({
      parent: editorPane,
      doc,
      sources: {
        notes: () => (tree?.notes ?? []).filter((p) => !p.startsWith("templates/")).map(titleOf),
        attachments: () => tree?.attachments ?? [],
        tags: () => this.tags,
      },
      onChange: () => this.changed(),
      onSave: () => this.save(),
      onPasteFiles: (files, pos) => this.upload(files, pos),
      onCursor: (l, c) => this.updateFoot(l, c),
    })
    document.body.append(this.root)
    document.documentElement.classList.add("kbe-open")
    this.updateTitle()
    this.setStatus()
    this.renderPreview()
    this.updateFoot(1, 1)
    requestAnimationFrame(() => this.view.focus())
    host.entries().then((es) => {
      const all = new Set<string>()
      es.forEach((e) => e.tags?.forEach((t) => all.add(t)))
      this.tags = [...all].sort((a, b) => a.localeCompare(b, "ru"))
    })
    loadTree().then(() => {
      this.render = createRenderer(this.previewCtx())
      this.renderPreview()
    })
  }

  tags: string[] = []

  /** Клавиши, пока окно открыто (ловим до CodeMirror, в фазе перехвата). */
  onKey = (e: KeyboardEvent) => {
    if (document.querySelector(".kbe-modal-back")) return
    // e.code, а не e.key: на русской раскладке Ctrl+S даёт «ы»
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyS") {
      e.preventDefault()
      e.stopPropagation()
      this.save()
    } else if (e.key === "Escape") {
      // Escape нужен подсказкам и панели поиска — отдаём его им
      if (this.root.querySelector(".cm-tooltip-autocomplete, .cm-search")) return
      e.preventDefault()
      e.stopPropagation()
      this.close()
    }
  }

  previewCtx(): PreviewCtx {
    const notes = new Map<string, string>()
    for (const p of tree?.notes ?? []) notes.set(titleOf(p).toLowerCase(), p)
    return { root: rootUrl(), notes, blobs }
  }

  updateTitle() {
    const d = dirOf(this.path)
    this.dirEl.textContent = d ? `${d} / ` : ""
    this.titleEl.textContent = titleOf(this.path)
  }

  updateFoot(line: number, col: number) {
    const text = this.view.state.doc.toString()
    const words = (text.replace(/^---[\s\S]*?---/, "").match(/[\p{L}\p{N}]+/gu) ?? []).length
    this.footEl.innerHTML = `<span>Строка ${line}, столбец ${col}</span><span>${words} слов</span><span class="kbe-sp"></span><span class="kbe-hint"><kbd>Ctrl S</kbd> сохранить · <kbd>[[</kbd> ссылка · <kbd>Esc</kbd> закрыть</span>`
  }

  setStatus(state?: "saving" | "error" | "auth", text?: string) {
    const s = state ?? (this.isNew ? "new" : this.dirty ? "dirty" : "clean")
    const label =
      text ??
      {
        new: "Новая заметка",
        dirty: "Не сохранено",
        clean: "Сохранено",
        saving: "Сохранение…",
        error: "Ошибка",
        auth: "Нужно войти",
      }[s]
    this.statusEl.dataset.state = s
    this.statusEl.textContent = label ?? ""
    this.root.classList.toggle("is-dirty", s === "dirty" || s === "new")
  }

  changed() {
    this.setStatus()
    clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => this.renderPreview(), 150)
    clearTimeout(this.draftTimer)
    this.draftTimer = window.setTimeout(() => this.saveDraft(), 700)
  }

  saveDraft() {
    if (!this.dirty) return store.del(draftKey(this.path))
    store.set(draftKey(this.path), {
      content: this.view.state.doc.toString(),
      base: this.sha,
      ts: Date.now(),
    } satisfies Draft)
  }

  renderPreview() {
    if (this.previewMode !== "preview") return
    const editorScroll = this.view.scrollDOM
    const ratio =
      editorScroll.scrollTop / Math.max(1, editorScroll.scrollHeight - editorScroll.clientHeight)
    this.previewEl.innerHTML = this.render(this.view.state.doc.toString())
    this.previewEl.scrollTop = ratio * (this.previewEl.scrollHeight - this.previewEl.clientHeight)
  }

  setMobileTab(tab: "text" | "preview") {
    this.root.classList.toggle("tab-preview", tab === "preview")
    this.root
      .querySelectorAll(".kbe-seg button")
      .forEach((b, i) => b.classList.toggle("on", (i === 1) === (tab === "preview")))
    if (tab === "preview") this.renderPreview()
    else this.view.focus()
  }

  showBanner(
    html: string,
    actions: { label: string; run: () => void; primary?: boolean }[],
    kind = "info",
  ) {
    this.banner.hidden = false
    this.banner.dataset.kind = kind
    this.banner.innerHTML = ""
    this.banner.append(el("span", { class: "kbe-banner-t", html }))
    for (const a of actions) {
      const b = el(
        "button",
        { type: "button", class: `kbe-btn sm ${a.primary ? "primary" : ""}` },
        a.label,
      )
      b.onclick = a.run
      this.banner.append(b)
    }
  }
  hideBanner() {
    this.banner.hidden = true
  }

  setDoc(text: string) {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } })
  }

  /* ── сохранение и конфликты ── */
  async save() {
    if (this.saving) return
    if (!this.dirty) {
      this.setStatus(undefined, "Без изменений")
      setTimeout(() => this.setStatus(), 1500)
      return
    }
    const err = checkNotePath(this.path)
    if (err) return alertBox("Неверное имя", esc(err))
    this.saving = true
    this.setStatus("saving")
    const content = this.view.state.doc.toString()
    const wasNew = this.isNew
    try {
      const r = await api.save(this.path, content, this.isNew ? null : this.sha)
      this.sha = r.sha
      this.isNew = false
      this.saved = content
      store.del(draftKey(this.path))
      if (tree && !tree.notes.includes(this.path)) tree.notes.push(this.path)
      this.hideBanner()
      this.setStatus()
      trackDeploy(r.commit, `«${esc(titleOf(this.path))}»`, { open: slugify(this.path) })
      if (wasNew)
        toast(`Заметка «${esc(titleOf(this.path))}» создана`, { kind: "ok", timeout: 3000 })
    } catch (e) {
      this.handleError(e as ApiError)
    } finally {
      this.saving = false
    }
  }

  handleError(e: ApiError) {
    if (e.status === 409 && e.data?.error === "conflict") return this.conflict(e.data.current)
    if (e.status === 409 && e.data?.error === "exists") {
      this.setStatus("error", "Имя занято")
      return alertBox(
        "Такая заметка уже есть",
        `По пути <b>${esc(this.path)}</b> уже есть файл. Переименуйте заметку.`,
      ).then(() => this.rename())
    }
    if (e.status === 401) {
      this.saveDraft()
      this.setStatus("auth")
      return this.showBanner(
        "Сессия истекла. Черновик сохранён в браузере — войдите снова, и он подхватится.",
        [
          {
            label: "Войти",
            primary: true,
            run: () => (location.href = api.loginUrl(location.pathname + "#edit")),
          },
        ],
        "error",
      )
    }
    this.setStatus("error", e.status === 0 ? "Нет сети" : "Ошибка")
    toast(esc(e.message || "Не удалось сохранить"), { kind: "error", timeout: 6000 })
  }

  conflict(remote: { sha: string; content: string } | null) {
    this.setStatus("error", "Конфликт")
    if (!remote) {
      return this.showBanner(
        "Заметку удалили или перенесли в другом месте. Можно сохранить её заново.",
        [
          {
            label: "Сохранить как новую",
            primary: true,
            run: () => ((this.isNew = true), this.save()),
          },
        ],
        "error",
      )
    }
    this.showBanner(
      "Заметка изменилась в другом месте (например, в Obsidian), пока вы её редактировали.",
      [
        { label: "Сравнить", run: () => this.showDiff(remote.content) },
        {
          label: "Взять их версию",
          run: () => {
            store.set(`kb-backup:${this.path}`, {
              content: this.view.state.doc.toString(),
              ts: Date.now(),
            })
            this.sha = remote.sha
            this.saved = remote.content
            this.setDoc(remote.content)
            this.previewMode = "preview"
            this.renderPreview()
            this.setStatus()
            this.showBanner("Ваша версия отложена в браузере.", [
              {
                label: "Вернуть мою",
                run: () => {
                  const b = store.get<{ content: string }>(`kb-backup:${this.path}`)
                  if (b) this.setDoc(b.content)
                  this.hideBanner()
                },
              },
              { label: "Скрыть", run: () => this.hideBanner() },
            ])
          },
        },
        {
          label: "Сохранить мою поверх",
          primary: true,
          run: () => {
            this.sha = remote.sha
            this.previewMode = "preview"
            this.save()
          },
        },
      ],
      "error",
    )
    this.showDiff(remote.content)
  }

  showDiff(theirs: string) {
    const mine = this.view.state.doc.toString()
    const d = lineDiff(theirs, mine)
    this.previewMode = "diff"
    this.root.classList.remove("no-preview")
    this.setMobileTab("preview")
    if (!d) {
      this.previewEl.innerHTML = `<p>Файлы слишком большие для сравнения.</p>`
      return
    }
    const rows = d
      .map(
        (x) =>
          `<div class="kbe-dl" data-t="${x.t === " " ? "same" : x.t === "-" ? "theirs" : "mine"}"><span>${x.t === " " ? "" : x.t === "-" ? "−" : "+"}</span><code>${esc(x.s) || " "}</code></div>`,
      )
      .join("")
    this.previewEl.innerHTML = `<div class="kbe-diff"><div class="kbe-diff-h"><span data-t="theirs">− только в их версии</span><span data-t="mine">+ только в вашей</span><button type="button" class="kbe-btn sm" data-back>К превью</button></div>${rows}</div>`
    this.previewEl.querySelector<HTMLElement>("[data-back]")!.onclick = () => {
      this.previewMode = "preview"
      this.renderPreview()
    }
  }

  /* ── картинки ── */
  pickFiles() {
    const input = el("input", {
      type: "file",
      accept: "image/*,application/pdf",
      multiple: true,
    }) as HTMLInputElement
    input.onchange = () =>
      this.upload([...(input.files ?? [])], this.view.state.selection.main.head)
    input.click()
  }

  async upload(files: File[], pos: number) {
    for (const f of files) {
      const id = Math.random().toString(36).slice(2, 7)
      const mark = `![[⏳ загрузка ${id}]]`
      this.view.dispatch({
        changes: { from: pos, insert: mark + "\n" },
        selection: { anchor: pos + mark.length + 1 },
      })
      pos += mark.length + 1
      const replaceMark = (text: string) => {
        const doc = this.view.state.doc.toString()
        const i = doc.indexOf(mark)
        if (i >= 0)
          this.view.dispatch({
            changes: { from: i, to: i + mark.length + (text ? 0 : 1), insert: text },
          })
      }
      try {
        const blob = await shrinkImage(f)
        const ext = extFor(blob.type || f.type)
        const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
        const base =
          f.name && !/^image\.\w+$/i.test(f.name)
            ? f.name.replace(/\.[^.]+$/, "")
            : `photo-${stamp}`
        const r = await api.upload(blob, `${base}.${ext}`)
        blobs.set(r.name, URL.createObjectURL(blob))
        tree?.attachments.push(r.name)
        replaceMark(`![[${r.name}]]`)
        this.view.focus()
        toast(`Загружено: ${esc(r.name)}`, { kind: "ok", timeout: 2500 })
      } catch (e) {
        replaceMark("")
        toast(`Не удалось загрузить ${esc(f.name || "файл")}: ${esc((e as Error).message)}`, {
          kind: "error",
          timeout: 6000,
        })
      }
    }
  }

  codeBlock() {
    const sel = this.view.state.selection.main
    const text = this.view.state.sliceDoc(sel.from, sel.to)
    if (text && !text.includes("\n")) return wrap(this.view, "`", "код")
    insertBlock(this.view, "```\n" + (text || "") + "\n```\n", 3)
  }

  calloutMenu() {
    const kinds: [string, string, string][] = [
      ["question", "Вопрос с собеседования (сворачивается)", "> [!question]- Вопрос?\n> Ответ.\n"],
      ["tip", "Совет", "> [!tip] Заголовок\n> Текст.\n"],
      ["warning", "Предупреждение", "> [!warning] Заголовок\n> Текст.\n"],
      ["note", "Заметка", "> [!note] Заголовок\n> Текст.\n"],
      ["example", "Пример", "> [!example] Пример\n> Текст.\n"],
    ]
    const list = el("div", { class: "kbe-menu-list" })
    const done = (snippet: string) => {
      back.remove()
      insertBlock(this.view, snippet, snippet.indexOf("]") + (snippet.includes("]-") ? 3 : 2))
    }
    for (const [k, label, snippet] of kinds) {
      const b = el("button", {
        type: "button",
        class: "kbe-menu-i",
        html: `<span class="kbe-cdot" data-k="${k}"></span>${esc(label)}`,
      })
      b.onclick = () => done(snippet)
      list.append(b)
    }
    const back = el(
      "div",
      { class: "kbe-modal-back light" },
      el("div", { class: "kbe-modal kbe-menu" }, list),
    )
    back.onclick = (e) => e.target === back && back.remove()
    document.body.append(back)
  }

  /* ── меню: переименовать, удалить, GitHub ── */
  menu() {
    const items: [string, string, () => void][] = [
      ["move", "Переименовать или перенести", () => this.rename()],
      ["eye", "Превью на весь экран", () => this.setMobileTab("preview")],
    ]
    if (this.htmlUrl)
      items.push(["external", "Открыть на GitHub", () => window.open(this.htmlUrl, "_blank")])
    if (!this.isNew) items.push(["trash", "Удалить заметку", () => this.remove()])
    const list = el("div", { class: "kbe-menu-list" })
    const back = el(
      "div",
      { class: "kbe-modal-back light" },
      el("div", { class: "kbe-modal kbe-menu kbe-menu-r" }, list),
    )
    for (const [ic, label, run] of items) {
      const b = el("button", {
        type: "button",
        class: `kbe-menu-i ${ic === "trash" ? "danger" : ""}`,
        html: `${icon(ic)}${esc(label)}`,
      })
      b.onclick = () => (back.remove(), run())
      list.append(b)
    }
    back.onclick = (e) => e.target === back && back.remove()
    document.body.append(back)
  }

  async rename() {
    await loadTree()
    const input = el("input", {
      class: "kbe-input",
      value: this.path,
      list: "kbe-dirs",
      spellcheck: "false",
    }) as HTMLInputElement
    const dl = el("datalist", { id: "kbe-dirs" })
    for (const d of tree?.dirs ?? [])
      dl.append(el("option", { value: `${d}/${titleOf(this.path)}.md` }))
    const err = el("p", { class: "kbe-err" })
    const body = el(
      "div",
      {},
      el("label", { class: "kbe-label" }, "Путь в хранилище (папка/Название.md)"),
      input,
      dl,
      err,
    )
    for (;;) {
      const v = await dialog("Переименовать или перенести", body, [
        { label: "Отмена", value: "cancel", kind: "ghost" },
        { label: this.isNew ? "Готово" : "Перенести", value: "ok", kind: "primary" },
      ])
      if (v !== "ok") return
      let to = input.value.trim().replace(/^\/+/, "")
      if (to && !/\.md$/i.test(to)) to += ".md"
      const problem = checkNotePath(to)
      if (problem) {
        err.textContent = problem
        continue
      }
      if (to === this.path) return
      if (tree?.notes.some((n) => n.toLowerCase() === to.toLowerCase())) {
        err.textContent = "Такая заметка уже есть"
        continue
      }
      if (this.isNew) {
        store.del(draftKey(this.path))
        this.path = to
        this.updateTitle()
        return
      }
      if (this.dirty) {
        err.textContent = "Сначала сохраните изменения"
        continue
      }
      try {
        const r = await api.move(this.path, to)
        store.del(draftKey(this.path))
        if (tree) tree.notes = tree.notes.filter((n) => n !== this.path).concat(to)
        this.path = to
        this.sha = r.sha
        this.updateTitle()
        trackDeploy(r.commit, `перенос «${esc(titleOf(to))}»`, { open: slugify(to) })
      } catch (e) {
        err.textContent = (e as Error).message
        continue
      }
      return
    }
  }

  async remove() {
    const v = await dialog(
      "Удалить заметку?",
      `«${esc(titleOf(this.path))}» исчезнет с сайта. Вернуть можно из истории репозитория на GitHub.`,
      [
        { label: "Отмена", value: "cancel", kind: "ghost" },
        { label: "Удалить", value: "ok", kind: "danger" },
      ],
    )
    if (v !== "ok" || !this.sha) return
    try {
      const r = await api.remove(this.path, this.sha)
      store.del(draftKey(this.path))
      this.saved = this.view.state.doc.toString()
      this.isNew = false
      this.destroy()
      trackDeploy(r.commit, `удаление «${esc(titleOf(this.path))}»`, { home: true })
    } catch (e) {
      this.handleError(e as ApiError)
    }
  }

  /* ── закрытие ── */
  async close(force = false) {
    if (!force && this.dirty) {
      const v = await dialog(
        "Сохранить изменения?",
        "Если не сохранить, черновик останется в этом браузере и подхватится при следующем открытии.",
        [
          { label: "Отмена", value: "cancel", kind: "ghost" },
          { label: "Не сохранять", value: "drop" },
          { label: "Сохранить", value: "save", kind: "primary" },
        ],
      )
      if (v === "save") {
        await this.save()
        if (this.dirty) return
      } else if (v !== "drop") return
      else this.saveDraft()
    }
    this.destroy()
  }

  destroy() {
    document.removeEventListener("keydown", this.onKey, true)
    clearTimeout(this.draftTimer)
    this.view.destroy()
    this.root.remove()
    document.documentElement.classList.remove("kbe-open")
    store.set("kb-editor-nopreview", this.root.classList.contains("no-preview"))
    if (current === this) current = null
    if (this.pushedHistory && location.hash === "#edit") history.back()
  }
}

/* ───────────── точки входа (их вызывает скрипт темы) ───────────── */

function attachHistory(s: Session) {
  if (location.hash !== "#edit") {
    history.pushState(history.state, "", location.pathname + location.search + "#edit")
    s.pushedHistory = true
  }
}

export async function openEditor(path: string) {
  if (current) return
  const loading = toast("Открываю редактор…", { spin: true })
  try {
    const f = await api.getFile(path)
    loading.close()
    const s = new Session({
      path,
      sha: f.sha,
      content: f.content,
      isNew: false,
      htmlUrl: f.htmlUrl,
    })
    current = s
    attachHistory(s)
    const draft = store.get<Draft>(draftKey(path))
    if (draft && draft.content !== f.content) {
      s.showBanner(`Есть несохранённый черновик (${ago(draft.ts)}).`, [
        {
          label: "Восстановить",
          primary: true,
          run: () => {
            s.setDoc(draft.content)
            // базой остаётся версия черновика: если файл с тех пор менялся, сохранение покажет конфликт
            if (draft.base) s.sha = draft.base
            s.hideBanner()
          },
        },
        { label: "Выбросить", run: () => (store.del(draftKey(path)), s.hideBanner()) },
      ])
    } else if (draft) store.del(draftKey(path))
  } catch (e) {
    loading.close()
    const err = e as ApiError
    if (err.status === 401) location.href = api.loginUrl(location.pathname + "#edit")
    else alertBox("Не удалось открыть заметку", esc(err.message))
  }
}

export async function newNote(folder = "") {
  if (current) return
  await loadTree()
  const title = el("input", {
    class: "kbe-input",
    placeholder: "Например: Индексы в PostgreSQL",
    spellcheck: "true",
  }) as HTMLInputElement
  const dir = el("input", {
    class: "kbe-input",
    value: folder,
    list: "kbe-newdirs",
    placeholder: "Корень хранилища",
    spellcheck: "false",
  }) as HTMLInputElement
  const dl = el("datalist", { id: "kbe-newdirs" })
  for (const d of tree?.dirs ?? [])
    if (!d.startsWith("templates") && d !== "attachments") dl.append(el("option", { value: d }))
  const templates = (tree?.notes ?? []).filter((n) => n.startsWith("templates/"))
  const tpl = el("select", { class: "kbe-input" }) as HTMLSelectElement
  tpl.append(el("option", { value: "" }, "Пустая заметка"))
  for (const t of templates)
    tpl.append(el("option", { value: t, selected: /Заметка/i.test(t) }, titleOf(t)))
  const err = el("p", { class: "kbe-err" })
  const body = el(
    "div",
    { class: "kbe-form" },
    el("label", { class: "kbe-label" }, "Название"),
    title,
    el("label", { class: "kbe-label" }, "Папка — можно вписать новую"),
    dir,
    dl,
    templates.length ? el("label", { class: "kbe-label" }, "Шаблон") : null,
    templates.length ? tpl : null,
    err,
  )
  for (;;) {
    const v = await dialog("Новая заметка", body, [
      { label: "Отмена", value: "cancel", kind: "ghost" },
      { label: "Создать", value: "ok", kind: "primary" },
    ])
    if (v !== "ok") return
    const name = title.value.trim()
    if (!name) {
      err.textContent = "Введите название"
      continue
    }
    const path = [dir.value.trim().replace(/^\/+|\/+$/g, ""), `${name}.md`]
      .filter(Boolean)
      .join("/")
    const problem = checkNotePath(path)
    if (problem) {
      err.textContent = problem
      continue
    }
    if (tree?.notes.some((n) => n.toLowerCase() === path.toLowerCase())) {
      err.textContent = "Такая заметка уже есть"
      continue
    }
    let content = `---\ntags: []\ndescription: \n---\n\n`
    if (tpl.value) {
      try {
        content = (await api.getFile(tpl.value)).content
      } catch {}
    }
    content = content.replace(/\{\{date\}\}/g, today()).replace(/\{\{title\}\}/g, name)
    const draft = store.get<Draft>(draftKey(path))
    const s = new Session({ path, sha: null, content: draft?.content ?? content, isNew: true })
    current = s
    attachHistory(s)
    return
  }
}

/** Вызывается при навигации по сайту: окно закрываем, черновик остаётся. */
export function onNav() {
  ensureToasts()
  if (current && location.hash !== "#edit") {
    current.saveDraft()
    current.pushedHistory = false
    current.destroy()
  }
}

export function isOpen() {
  return !!current
}

export function isDirty() {
  return !!current?.dirty
}
