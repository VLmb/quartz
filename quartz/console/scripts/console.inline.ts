// Клиентская логика темы «Консоль»: тема, поиск-палитра, проводник, оглавление,
// прогресс чтения, главная (недавние, повторение), блоки кода, PWA.
import { iconString } from "../iconPaths"

type Entry = {
  slug: string
  title: string
  content: string
  tags: string[]
  filePath?: string
  description?: string
}
type Opened = { s: string; t: number; p: number }

const html = document.documentElement

/* ───────────── хранилище ───────────── */
const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k)
      return v == null ? d : (JSON.parse(v) as T)
    } catch {
      return d
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {}
  },
}

/* ───────────── пути ───────────── */
function currentSlug(): string {
  return document.body.dataset.slug || "index"
}
function rootUrl(): URL {
  const depth = currentSlug().split("/").length - 1
  return new URL(depth > 0 ? "../".repeat(depth) : "./", location.href)
}
function urlFor(slug: string): URL {
  const s = slug === "index" ? "" : slug.endsWith("/index") ? slug.slice(0, -5) : slug
  return new URL(s, rootUrl())
}
function go(url: URL) {
  closePalette()
  if (typeof window.spaNavigate === "function") window.spaNavigate(url)
  else location.href = url.toString()
}

/* ───────────── время ───────────── */
const months = [
  "янв.",
  "февр.",
  "марта",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
]
function ago(ts: number, short = false): string {
  if (!ts) return ""
  const s = Math.max(0, (Date.now() - ts) / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  const tail = short ? "" : " назад"
  if (m < 1) return "только что"
  if (m < 60) return `${m} мин${tail}`
  if (h < 24) return `${h} ч${tail}`
  if (d === 1) return "вчера"
  if (d < 7) return `${d} ${d < 5 ? "дня" : "дней"}${tail}`
  const dt = new Date(ts)
  return `${dt.getDate()} ${months[dt.getMonth()]}`
}
function renderTimes(root: Pick<ParentNode, "querySelectorAll"> = document) {
  root.querySelectorAll<HTMLElement>("time[data-ago]").forEach((el) => {
    const ts = Number(el.dataset.ago)
    if (!ts) return
    const short = !!el.closest(".c-when")
    el.textContent = (el.dataset.prefix ?? "") + ago(ts, short)
  })
}
function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

/* ───────────── тема ───────────── */
function setTheme(t: "light" | "dark") {
  html.setAttribute("saved-theme", t)
  try {
    localStorage.setItem("theme", t)
  } catch {}
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", t === "dark" ? "#08090a" : "#ffffff"))
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: t } }))
}
/* ───────────── оформление: Linear / «Консоль» ───────────── */
function currentSkin(): "linear" | "console" {
  return html.getAttribute("data-skin") === "console" ? "console" : "linear"
}
function markSkin() {
  const skin = currentSkin()
  document
    .querySelectorAll<HTMLElement>("[data-skin-set]")
    .forEach((b) => b.classList.toggle("on", b.dataset.skinSet === skin))
}
function setSkin(skin: "linear" | "console") {
  html.setAttribute("data-skin", skin)
  try {
    localStorage.setItem("skin", skin)
  } catch {}
  markSkin()
  // граф перечитывает цвета на событие смены темы
  const t = html.getAttribute("saved-theme") === "light" ? "light" : "dark"
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: t } }))
}

function toggleTheme() {
  const next = html.getAttribute("saved-theme") === "dark" ? "light" : "dark"
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    html.classList.add("theme-anim")
    const vt = d.startViewTransition(() => setTheme(next)) as { finished?: Promise<void> }
    vt.finished?.finally(() => html.classList.remove("theme-anim"))
  } else setTheme(next)
}

/* ───────────── индекс контента ───────────── */
let entries: Entry[] | null = null
async function getEntries(): Promise<Entry[]> {
  if (entries) return entries
  const data = (await fetchData) as unknown as Record<string, Omit<Entry, "slug">>
  entries = Object.entries(data)
    .filter(([slug]) => !slug.startsWith("tags/") && slug !== "404")
    .map(([slug, d]) => ({
      slug,
      ...d,
      title: decode(d.title ?? slug),
      tags: d.tags ?? [],
      content: decode(d.content ?? ""),
    }))
  return entries
}
// В индексе текст хранится с HTML-сущностями (&quot; и т.п.) — раскодируем.
const decoder = document.createElement("textarea")
function decode(s: string): string {
  if (!s.includes("&")) return s
  decoder.innerHTML = s
  return decoder.value
}
function topicOf(e: Entry): string {
  const fp = (e.filePath ?? "").replace(/\\/g, "/").split("/")
  return fp.length > 1 ? fp[fp.length - 2] : ""
}
function excerptOf(e: Entry): string {
  if (e.description) return e.description
  return e.content.slice(0, 140)
}
function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  )
}
function highlight(text: string, tokens: string[]): string {
  let out = esc(text)
  for (const t of tokens) {
    if (!t) continue
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
    out = out.replace(re, "<mark>$1</mark>")
  }
  return out
}

/* ───────────── палитра поиска ───────────── */
let palActive = 0
let palResults: { e: Entry; snippet: string }[] = []

function openPalette() {
  html.classList.add("palette-open")
  const input = document.querySelector<HTMLInputElement>("[data-palette-input]")
  if (input) {
    input.value = ""
    setTimeout(() => input.focus(), 30)
  }
  runSearch("")
}
function closePalette() {
  html.classList.remove("palette-open")
}

async function runSearch(q: string) {
  const list = document.querySelector<HTMLElement>("[data-palette-list]")
  const count = document.querySelector<HTMLElement>("[data-palette-count]")
  if (!list) return
  const all = await getEntries()
  const query = q.trim().toLowerCase()
  let group = "Недавно открытые"
  if (!query) {
    const opened = store.get<Opened[]>("kb-opened", [])
    const bySlug = new Map(all.map((e) => [e.slug, e]))
    const recent = opened.map((o) => bySlug.get(o.s)).filter(Boolean) as Entry[]
    const rest = all
      .filter((e) => !recent.includes(e))
      .sort((a, b) => a.title.localeCompare(b.title, "ru"))
    palResults = [...recent.slice(0, 6), ...rest]
      .slice(0, 30)
      .map((e) => ({ e, snippet: esc(excerptOf(e)) }))
    if (recent.length === 0) group = "Все заметки"
  } else {
    group = "Заметки"
    const tagOnly = query.startsWith("#")
    const tokens = (tagOnly ? query.slice(1) : query).split(/\s+/).filter(Boolean)
    const scored: { e: Entry; score: number; snippet: string }[] = []
    for (const e of all) {
      const t = e.title.toLowerCase()
      const tg = e.tags.map((x) => x.toLowerCase())
      const c = e.content.toLowerCase()
      let score = 0
      if (tagOnly) {
        if (tokens.every((k) => tg.some((x) => x.includes(k)))) score = 50
      } else {
        if (t === query) score += 200
        if (t.startsWith(query)) score += 100
        else if (t.includes(query)) score += 60
        if (tokens.every((k) => t.includes(k))) score += 40
        if (tokens.some((k) => tg.some((x) => x.includes(k)))) score += 30
        if (tokens.every((k) => c.includes(k) || t.includes(k) || tg.some((x) => x.includes(k))))
          score += 10
        else if (score < 40) score = 0
      }
      if (score <= 0) continue
      let snippet = esc(excerptOf(e))
      const first = tokens.find((k) => c.includes(k))
      if (first && !t.includes(first)) {
        const i = c.indexOf(first)
        const start = Math.max(0, i - 50)
        const raw = (start > 0 ? "…" : "") + e.content.slice(start, i + 90)
        snippet = highlight(raw, tokens)
      }
      scored.push({ e, score, snippet })
    }
    scored.sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title, "ru"))
    palResults = scored.slice(0, 40)
    for (const r of palResults) (r as { title?: string }).title = highlight(r.e.title, tokens)
  }
  palActive = 0
  if (count) count.textContent = query ? `${palResults.length} найдено` : ""
  if (palResults.length === 0) {
    list.innerHTML = `<div class="palette-empty">Ничего не нашлось. Попробуй другое слово или <kbd>#тег</kbd>.</div>`
    return
  }
  list.innerHTML =
    `<div class="palette-group">${group}</div>` +
    palResults
      .map((r, i) => {
        const title = (r as { title?: string }).title ?? esc(r.e.title)
        const topic = topicOf(r.e)
        return `<a class="palette-item${i === 0 ? " active" : ""}" href="${urlFor(r.e.slug)}" data-i="${i}" style="--i:${Math.min(i, 12)}">
          <span class="palette-dot"></span>
          <span class="palette-text"><span class="palette-title">${title}</span><span class="palette-ex">${r.snippet}</span></span>
          ${topic ? `<span class="palette-topic">${esc(topic)}</span>` : ""}
        </a>`
      })
      .join("")
}
function movePalette(delta: number) {
  const items = document.querySelectorAll<HTMLElement>(".palette-item")
  if (items.length === 0) return
  items[palActive]?.classList.remove("active")
  palActive = (palActive + delta + items.length) % items.length
  const el = items[palActive]
  el.classList.add("active")
  el.scrollIntoView({ block: "nearest" })
}

/* ───────────── проводник ───────────── */
function saveOpenDirs() {
  const open = [...document.querySelectorAll<HTMLElement>(".tree li[data-dir].open")].map(
    (li) => li.dataset.dir!,
  )
  store.set("kb-open-dirs", open)
}
function restoreExplorer() {
  const open = new Set(store.get<string[]>("kb-open-dirs", []))
  document.querySelectorAll<HTMLElement>(".tree li[data-dir]").forEach((li) => {
    if (open.has(li.dataset.dir!)) li.classList.add("open")
  })
  const cur = document.querySelector<HTMLElement>("[data-explorer] .f-file.on")
  const pane = document.querySelector<HTMLElement>("[data-explorer]")
  if (cur && pane) {
    const top = cur.offsetTop
    if (top < pane.scrollTop || top > pane.scrollTop + pane.clientHeight - 40) {
      pane.scrollTop = top - pane.clientHeight / 3
    }
  }
}

/* ───────────── недавно открытые и прогресс ───────────── */
function recordOpened() {
  const slug = currentSlug()
  if (document.querySelector(".shell")?.getAttribute("data-kind") !== "note") return
  const list = store.get<Opened[]>("kb-opened", [])
  const prev = list.find((o) => o.s === slug)
  const next = [
    { s: slug, t: Date.now(), p: prev?.p ?? 0 },
    ...list.filter((o) => o.s !== slug),
  ].slice(0, 30)
  store.set("kb-opened", next)
}
function saveProgress(p: number) {
  const slug = currentSlug()
  const list = store.get<Opened[]>("kb-opened", [])
  const item = list.find((o) => o.s === slug)
  if (item) {
    item.p = Math.max(0, Math.min(1, p))
    store.set("kb-opened", list)
  }
}
function scrollProgress(): number {
  const max = document.documentElement.scrollHeight - innerHeight
  return max > 0 ? scrollY / max : 1
}

/* ───────────── оглавление ───────────── */
function setupToc() {
  const tocs = [...document.querySelectorAll<HTMLElement>("[data-toc]")]
  if (tocs.length === 0) return () => {}
  const ids = [...tocs[0].querySelectorAll<HTMLAnchorElement>(".toc-link")].map(
    (a) => a.dataset.for!,
  )
  const heads = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
  let last = ""
  const update = () => {
    let active = heads[0]?.id ?? ""
    for (const h of heads) if (h.getBoundingClientRect().top < 140) active = h.id
    if (active === last) return
    last = active
    for (const toc of tocs) {
      const links = toc.querySelectorAll<HTMLAnchorElement>(".toc-link")
      let target: HTMLElement | null = null
      links.forEach((a) => {
        const on = a.dataset.for === active
        a.classList.toggle("active", on)
        if (on) target = a
      })
      const ind = toc.querySelector<HTMLElement>(".toc-indicator")
      if (ind && target) {
        const t = target as HTMLElement
        ind.style.setProperty("--ty", `${t.offsetTop}px`)
        ind.style.setProperty("--th", `${t.offsetHeight}px`)
      }
    }
  }
  update()
  return update
}

/* ───────────── блоки кода ───────────── */
function enhanceCode() {
  // подпись [!tip] перед заголовком callout, как в Obsidian
  document
    .querySelectorAll<HTMLElement>(".prose .callout[data-callout] > .callout-title p")
    .forEach((p) => {
      const c = p.closest<HTMLElement>(".callout")
      if (c && !p.dataset.type) p.dataset.type = c.dataset.callout ?? "note"
    })
  document
    .querySelectorAll<HTMLElement>("figure[data-rehype-pretty-code-figure]")
    .forEach((fig) => {
      if (fig.dataset.enhanced) return
      fig.dataset.enhanced = "1"
      fig.classList.add("code-block")
      const pre = fig.querySelector("pre")
      const cap = fig.querySelector("figcaption")
      const lang = pre?.dataset.language ?? ""
      const head = document.createElement("div")
      head.className = "code-head"
      head.innerHTML =
        `<span class="code-lang">${esc(lang === "plaintext" ? "text" : lang)}</span>` +
        (cap ? `<span class="code-file">${esc(cap.textContent ?? "")}</span>` : "") +
        `<button class="copy-btn" type="button" aria-label="Скопировать">${iconString("copy", "i-copy")}${iconString("check", "i-check")}</button>`
      if (cap) cap.remove()
      fig.prepend(head)
    })
}

/* ───────────── главная ───────────── */
function rowHtml(e: Entry, i: number, when?: number) {
  const topic = topicOf(e)
  const tags = e.tags.length
    ? `<span class="pills">${e.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</span>`
    : ""
  return `<a class="row card" href="${urlFor(e.slug)}" data-key="${i + 1}" data-slug="${esc(e.slug)}">
    ${iconString("file", "row-ic")}
    <span class="row-t">${esc(e.title)}</span>
    <span class="row-x">${esc(excerptOf(e))}</span>
    ${tags}
    <span class="badge">${esc(topic || "/")}</span>
    <span class="row-when">${when ? `<time data-ago="${when}"></time>` : ""}</span>
    ${i < 8 ? `<kbd class="row-k">${i + 1}</kbd>` : ""}
  </a>`
}

function continueHtml(e: Entry, p: number, when: number) {
  const words = e.content.split(/\s+/).length
  const left = Math.max(1, Math.round((words * (1 - p)) / 180))
  const pct = Math.round(p * 100)
  return `<div class="cont-main">
      <span class="cont-label">Продолжить чтение · ${esc(topicOf(e) || "/")}</span>
      <h2 class="cont-t">${esc(e.title)}</h2>
      <p class="cont-x">${esc(excerptOf(e))}</p>
    </div>
    <a class="btn-primary" href="${urlFor(e.slug)}">Продолжить ${iconString("arrowRight")}</a>
    <div class="cont-prog"><span class="cont-bar"><i style="width:${pct}%"></i></span>${pct}% · ещё ${left} мин · <time data-ago="${when}"></time></div>`
}

async function setupHome() {
  const cards = document.querySelector<HTMLElement>("[data-cards]")
  if (!cards) return
  const all = await getEntries()
  const bySlug = new Map(all.map((e) => [e.slug, e]))
  const opened = store.get<Opened[]>("kb-opened", []).filter((o) => bySlug.has(o.s))

  // «Продолжить чтение»: последняя заметка, дочитанная не до конца
  const box = document.querySelector<HTMLElement>("[data-continue]")
  const cont = opened.find((o) => o.p > 0.03 && o.p < 0.95)
  if (box) {
    box.hidden = !cont
    if (cont) box.innerHTML = continueHtml(bySlug.get(cont.s)!, cont.p, cont.t)
  }

  // «открытые»
  const openedBox = document.querySelector<HTMLElement>("[data-cards-opened]")
  if (openedBox) {
    openedBox.innerHTML = opened.length
      ? opened
          .slice(0, 8)
          .map((o, i) => rowHtml(bySlug.get(o.s)!, i, o.t))
          .join("")
      : `<p class="empty">Здесь появятся заметки, которые ты открывал на этом устройстве.</p>`
  }
  applyHomeModes()
  renderTimes()
}

function applyHomeModes() {
  const seg = store.get<string>("kb-home-seg", "modified")
  const vt = store.get<string>("kb-home-vt", "list")
  document
    .querySelectorAll<HTMLButtonElement>("[data-seg] button")
    .forEach((b) => b.classList.toggle("on", b.dataset.mode === seg))
  document
    .querySelectorAll<HTMLButtonElement>("[data-vt] button")
    .forEach((b) => b.classList.toggle("on", b.dataset.mode === vt))
  const a = document.querySelector<HTMLElement>("[data-cards]")
  const b = document.querySelector<HTMLElement>("[data-cards-opened]")
  if (a && b) {
    a.hidden = seg !== "modified"
    b.hidden = seg !== "opened"
    a.classList.toggle("grid", vt === "grid")
    b.classList.toggle("grid", vt === "grid")
  }
}

function reviewBadge() {
  const b = document.querySelector<HTMLElement>("[data-review-badge]")
  const v = store.get<{ day: string; n: number } | null>("kb-review-due", null)
  if (b) b.textContent = v && v.day === todayIso() && v.n > 0 ? String(v.n) : ""
}

function setupReview() {
  const box = document.querySelector<HTMLElement>("[data-review]")
  if (!box) return
  const today = todayIso()
  const done = new Set(store.get<string[]>("kb-review-done", []))
  let due = 0
  let next: { d: string; t: string } | null = null
  box.querySelectorAll<HTMLElement>("li[data-due]").forEach((li) => {
    const d = li.dataset.due!
    const key = `${li.dataset.slug}@${d}`
    const diff = daysBetween(d, today)
    const label = li.querySelector<HTMLElement>(".td-d")!
    const input = li.querySelector<HTMLInputElement>("input")!
    input.checked = done.has(key)
    if (diff < 0) {
      li.hidden = true
      if (!next) next = { d, t: li.querySelector(".row-t")?.textContent ?? "" }
      return
    }
    li.hidden = false
    label.textContent = diff === 0 ? "сегодня" : `просрочено на ${diff} дн.`
    label.classList.toggle("late", diff > 0)
    if (!input.checked) due++
  })
  const count = document.querySelector<HTMLElement>("[data-review-count]")
  if (count) count.textContent = String(due)
  store.set("kb-review-due", { day: today, n: due })
  const visible = box.querySelectorAll("li:not([hidden])").length
  box.hidden = visible === 0
  const empty = document.querySelector<HTMLElement>("[data-review-empty]")
  if (empty) {
    empty.hidden = visible > 0
    const n = empty.querySelector<HTMLElement>("[data-review-next]")
    if (n) {
      const nx = next as { d: string; t: string } | null
      n.textContent = nx
        ? `Следующее: ${nx.t}, ${nx.d}.`
        : "Добавь review: ГГГГ-ММ-ДД во frontmatter заметки."
    }
  }
}

/* ───────────── редактирование на сайте ───────────── */
type Me = { login: string; name: string; avatar: string | null }
type EditorModule = {
  init: (h: { root: string; entries: () => Promise<Entry[]> }) => void
  openEditor: (path: string) => Promise<void>
  newNote: (folder?: string) => Promise<void>
  onNav: () => void
  isDirty: () => boolean
  toast: (html: string, o?: { kind?: string; timeout?: number }) => unknown
}
let editorModule: EditorModule | null = null
let editorLoading: Promise<EditorModule> | null = null

function apiUrl(path: string): URL {
  return new URL(`api/${path}`, rootUrl())
}

function loadEditor(): Promise<EditorModule> {
  if (!editorLoading) {
    const file = document.querySelector<HTMLElement>("[data-editor-url]")?.dataset.editorUrl
    if (!file) return Promise.reject(new Error("Редактор не собран"))
    editorLoading = import(new URL(file, rootUrl()).toString()).then((m: EditorModule) => {
      m.init({ root: rootUrl().pathname, entries: getEntries })
      editorModule = m
      return m
    })
    editorLoading.catch(() => (editorLoading = null))
  }
  return editorLoading
}

function applyMe(me: Me | null) {
  html.classList.toggle("kb-auth", !!me)
  document
    .querySelectorAll<HTMLElement>("[data-account-login]")
    .forEach((e) => (e.textContent = me?.login ?? ""))
  document.querySelectorAll<HTMLImageElement>("[data-account-avatar]").forEach((img) => {
    if (me?.avatar) img.src = me.avatar
    img.hidden = !me?.avatar
  })
}

/** Есть ли бэкенд и вошёл ли пользователь. Без бэкенда кнопки редактирования не показываем. */
async function checkAuth() {
  const cached = store.get<Me | null>("kb-me", null)
  if (cached) html.classList.add("kb-api")
  applyMe(cached)
  try {
    const r = await fetch(apiUrl("me"), { credentials: "same-origin", cache: "no-store" })
    const isJson = (r.headers.get("content-type") ?? "").includes("json")
    const body = await r.text() // дочитываем всегда, чтобы соединение не висело
    if (r.ok && isJson) {
      const me = JSON.parse(body) as Me
      store.set("kb-me", me)
      html.classList.add("kb-api")
      applyMe(me)
    } else if (r.status === 401 && isJson) {
      store.set("kb-me", null)
      html.classList.add("kb-api")
      applyMe(null)
    } else {
      html.classList.remove("kb-api")
      applyMe(null)
    }
  } catch {
    // нет сети — оставляем то, что знали
  }
}

function currentNotePath(): string | null {
  return document.querySelector<HTMLElement>("main[data-file-path]")?.dataset.filePath ?? null
}

function login() {
  location.href = apiUrl(
    `auth/login?next=${encodeURIComponent(location.pathname + location.search)}`,
  ).toString()
}

async function editCurrent() {
  const path = currentNotePath()
  if (!path) return
  if (!html.classList.contains("kb-auth")) return login()
  try {
    ;(await loadEditor()).openEditor(path)
  } catch {
    alert("Не удалось загрузить редактор. Проверьте соединение.")
  }
}

async function newNoteHere() {
  if (!html.classList.contains("kb-auth")) return login()
  const folder = document.querySelector<HTMLElement>("main[data-folder]")?.dataset.folder ?? ""
  ;(await loadEditor()).newNote(folder)
}

/** Сообщение после возврата со страницы входа GitHub (?kb-auth=...). */
async function handleAuthReturn() {
  const params = new URLSearchParams(location.search)
  const status = params.get("kb-auth")
  if (!status) return
  params.delete("kb-auth")
  const q = params.toString()
  history.replaceState(history.state, "", location.pathname + (q ? `?${q}` : "") + location.hash)
  const text =
    status === "ok"
      ? "Вы вошли — можно редактировать заметки"
      : status === "denied"
        ? "Этому аккаунту GitHub редактирование не разрешено"
        : "Не удалось войти через GitHub, попробуйте ещё раз"
  try {
    ;(await loadEditor()).toast(text, { kind: status === "ok" ? "ok" : "error", timeout: 5000 })
  } catch {}
}

/* ───────────── обработчики (один раз) ───────────── */
function bindGlobal() {
  document.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement
    if (t.closest("[data-theme-toggle]")) {
      ev.preventDefault()
      toggleTheme()
      return
    }
    const skinSet = t.closest<HTMLElement>("[data-skin-set]")
    if (skinSet) {
      setSkin(skinSet.dataset.skinSet === "console" ? "console" : "linear")
      return
    }
    if (t.closest("[data-skin-toggle]")) {
      setSkin(currentSkin() === "console" ? "linear" : "console")
      return
    }
    if (t.closest("[data-edit]")) {
      ev.preventDefault()
      html.classList.remove("drawer-open")
      editCurrent()
      return
    }
    if (t.closest("[data-new-note]")) {
      ev.preventDefault()
      html.classList.remove("drawer-open")
      newNoteHere()
      return
    }
    if (t.closest("[data-login]")) {
      ev.preventDefault()
      login()
      return
    }
    if (t.closest("[data-logout]")) {
      ev.preventDefault()
      fetch(apiUrl("auth/logout"), {
        method: "POST",
        headers: { "X-KB-Request": "1" },
        credentials: "same-origin",
      })
        .catch(() => {})
        .finally(() => {
          store.set("kb-me", null)
          applyMe(null)
        })
      return
    }
    if (t.closest("[data-search]")) {
      ev.preventDefault()
      html.classList.remove("drawer-open")
      openPalette()
      return
    }
    if (t.closest("[data-palette-backdrop]")) {
      closePalette()
      return
    }
    if (t.closest("[data-global-graph]")) {
      ev.preventDefault()
      html.classList.remove("drawer-open")
      document.querySelector<HTMLElement>(".global-graph-icon")?.click()
      return
    }
    if (t.closest("[data-drawer]")) {
      html.classList.toggle("drawer-open")
      return
    }
    if (t.closest("[data-drawer-backdrop]")) {
      html.classList.remove("drawer-open")
      return
    }
    const dir = t.closest<HTMLElement>(".f-dir")
    if (dir) {
      dir.parentElement?.classList.toggle("open")
      saveOpenDirs()
      return
    }
    const seg = t.closest<HTMLElement>("[data-seg] button")
    if (seg) {
      store.set("kb-home-seg", seg.dataset.mode)
      applyHomeModes()
      return
    }
    const vt = t.closest<HTMLElement>("[data-vt] button")
    if (vt) {
      store.set("kb-home-vt", vt.dataset.mode)
      applyHomeModes()
      return
    }
    const copy = t.closest<HTMLElement>(".copy-btn")
    if (copy) {
      const code = copy.closest("figure")?.querySelector("code")
      const text = (code as HTMLElement | null)?.innerText ?? ""
      navigator.clipboard?.writeText(text.replace(/\n\n/g, "\n")).then(() => {
        copy.classList.add("copied")
        setTimeout(() => copy.classList.remove("copied"), 1600)
      })
      return
    }
    const item = t.closest<HTMLAnchorElement>(".palette-item")
    if (item) {
      ev.preventDefault()
      go(new URL(item.href))
    }
  })

  document.addEventListener("change", (ev) => {
    const input = ev.target as HTMLInputElement
    const li = input.closest<HTMLElement>("[data-review] li")
    if (!li) return
    const key = `${li.dataset.slug}@${li.dataset.due}`
    const done = new Set(store.get<string[]>("kb-review-done", []))
    if (input.checked) done.add(key)
    else done.delete(key)
    store.set("kb-review-done", [...done].slice(-300))
    setupReview()
    reviewBadge()
  })

  document.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement
    if (t.matches("[data-palette-input]")) runSearch(t.value)
  })

  document.addEventListener("keydown", (ev) => {
    const open = html.classList.contains("palette-open")
    const typing = (ev.target as HTMLElement).closest("input, textarea, [contenteditable]")
    if ((ev.ctrlKey || ev.metaKey) && ev.code === "KeyK") {
      ev.preventDefault()
      open ? closePalette() : openPalette()
      return
    }
    if (open) {
      if (ev.key === "Escape") closePalette()
      else if (ev.key === "ArrowDown") {
        ev.preventDefault()
        movePalette(1)
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault()
        movePalette(-1)
      } else if (ev.key === "Enter") {
        ev.preventDefault()
        const r = palResults[palActive]
        if (r) go(urlFor(r.e.slug))
      }
      return
    }
    if (ev.key === "Escape") html.classList.remove("drawer-open")
    if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return
    if (ev.key === "/") {
      ev.preventDefault()
      openPalette()
      return
    }
    if (ev.key === "e" && html.classList.contains("kb-auth") && currentNotePath()) {
      ev.preventDefault()
      editCurrent()
      return
    }
    if (/^[1-8]$/.test(ev.key)) {
      const box = document.querySelector<HTMLElement>(
        "[data-cards]:not([hidden]), [data-cards-opened]:not([hidden])",
      )
      const card = box?.querySelector<HTMLAnchorElement>(`.card[data-key="${ev.key}"]`)
      if (card) go(new URL(card.href))
    }
  })

  const onlineState = () => html.classList.toggle("is-offline", !navigator.onLine)
  addEventListener("online", onlineState)
  addEventListener("offline", onlineState)
  onlineState()

  // PWA: service worker живёт в корне сайта
  if (
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost")
  ) {
    navigator.serviceWorker.register(new URL("sw.js", rootUrl()).toString()).catch(() => {})
  }

  setInterval(() => renderTimes(), 60_000)

  addEventListener("beforeunload", (e) => {
    if (editorModule?.isDirty()) e.preventDefault()
  })
  handleAuthReturn()
  checkAuth().then(() => {
    if (location.hash === "#edit" && html.classList.contains("kb-auth")) editCurrent()
  })
}

/* ───────────── каждая навигация ───────────── */
function onNav() {
  editorModule?.onNav()
  applyMe(html.classList.contains("kb-auth") ? store.get<Me | null>("kb-me", null) : null)
  closePalette()
  html.classList.remove("drawer-open")
  renderTimes()
  restoreExplorer()
  enhanceCode()
  recordOpened()
  setupReview()
  reviewBadge()
  setupHome()

  markSkin()
  const bars = document.querySelectorAll<HTMLElement>("[data-progress]")
  const tocUpdate = setupToc()
  let raf = 0
  let saveTimer = 0
  const onScroll = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const p = scrollProgress()
      bars.forEach((bar) => bar.style.setProperty("--p", String(p)))
      tocUpdate()
      clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => saveProgress(p), 400)
    })
  }
  onScroll()
  addEventListener("scroll", onScroll, { passive: true })
  window.addCleanup(() => {
    removeEventListener("scroll", onScroll)
    clearTimeout(saveTimer)
  })
}

bindGlobal()
document.addEventListener("nav", onNav)
if (new URLSearchParams(location.search).has("search")) setTimeout(openPalette, 300)
document.addEventListener("render", () => enhanceCode())
