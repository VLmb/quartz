// Задачи: списки Google Tasks (живые, через kb-api). Колонки на компьютере, аккордеон на
// телефоне. Задачи и списки перетаскиваются; порядок задач хранит Google, порядок списков,
// свёрнутые и скрытые списки — сервер (одинаково на всех устройствах).
import { call, HttpError, loginUrl } from "./api"
import { el, slugify, store } from "../editor/util"
import type { Ctx } from "./inbox"

type Task = {
  id: string
  title: string
  notes: string
  due: string | null
  done: boolean
  completed: string | null
  parent: string | null
  note: string | null
}
type List = { id: string; title: string; tasks: Task[] }
type Prefs = { order: string[]; collapsed: string[]; hidden: string[] }
type Board = { lists: List[]; prefs: Prefs }
type View = "lists" | "today" | "week"

let root: HTMLElement | null = null
let ctx: Ctx = { flash: () => {} }
let board: Board | null = null
let error: { status: number; message: string } | null = null
let view: View = (store.get<View>("kb-tasks-view") as View) || "lists"
let sel: { listId: string; id: string } | null = null
let adding: string | null = null
let showDone = new Set<string>()
let showHidden = false
let dragging = false
let siteRoot = "/"

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  trash:
    '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
}
const svg = (name: keyof typeof ICON, cls = "") =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`

/* ───── даты ───── */

const pad = (n: number) => String(n).padStart(2, "0")
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}
function dueInfo(due: string | null): { label: string; cls: string } | null {
  if (!due) return null
  const today = addDays(0)
  if (due === today) return { label: "Сегодня", cls: "today" }
  if (due === addDays(1)) return { label: "Завтра", cls: "" }
  if (due === addDays(-1)) return { label: "Вчера", cls: "late" }
  const d = new Date(`${due}T12:00:00`)
  const days = Math.round((d.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)
  const short = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "")
  if (days < 0) return { label: short, cls: "late" }
  if (days < 7)
    return { label: `${d.toLocaleDateString("ru-RU", { weekday: "short" })}, ${short}`, cls: "" }
  return { label: short, cls: "" }
}

/* ───── данные ───── */

const visibleLists = () =>
  (board?.lists ?? []).filter((l) => showHidden || !board!.prefs.hidden.includes(l.id))
const findList = (id: string) => board?.lists.find((l) => l.id === id) ?? null
const findTask = (listId: string, id: string) =>
  findList(listId)?.tasks.find((t) => t.id === id) ?? null
const topLevel = (l: List) => {
  const ids = new Set(l.tasks.map((t) => t.id))
  return l.tasks.filter((t) => !t.parent || !ids.has(t.parent))
}
const childrenOf = (l: List, id: string) => l.tasks.filter((t) => t.parent === id)
const openCount = () =>
  (board?.lists ?? []).reduce((n, l) => n + l.tasks.filter((t) => !t.done).length, 0)

async function load(quiet = false) {
  try {
    board = await call<Board>("GET", "gtasks/board")
    error = null
  } catch (e) {
    const err = e as HttpError
    if (!quiet || !board) error = { status: err.status, message: err.message }
  }
  render()
}

async function savePrefs() {
  if (!board) return
  try {
    board.prefs = await call<Prefs>("PUT", "gtasks/prefs", board.prefs)
  } catch (e) {
    ctx.flash((e as Error).message)
  }
}

/** Действие с задачей: сразу меняем на экране, при ошибке — перечитываем с сервера. */
async function act(fn: () => Promise<unknown>) {
  render()
  try {
    await fn()
  } catch (e) {
    ctx.flash((e as Error).message)
    await load(true)
  }
}

/* ───── монтирование ───── */

export function mount(container: HTMLElement, c: Ctx, rootUrl: string) {
  root = container
  ctx = c
  siteRoot = rootUrl
  sel = null
  adding = null
  root.closest(".space-view")?.classList.add("ready")
  render()
  load()
  document.addEventListener("visibilitychange", onVisible)
  document.addEventListener("keydown", onKey)
}

export function unmount() {
  document.removeEventListener("visibilitychange", onVisible)
  document.removeEventListener("keydown", onKey)
  root = null
}

const onVisible = () => {
  if (document.visibilityState === "visible" && !dragging && !sel) load(true)
}
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape" && sel) {
    sel = null
    render()
  }
}

/* ───── отрисовка ───── */

function render() {
  if (!root || dragging) return
  const head = el(
    "div",
    { class: "sp-head" },
    el("h1", { class: "sp-title" }, "Задачи"),
    el("span", { class: "sp-count" }, board ? String(openCount() || "") : ""),
    el("span", { class: "sp-sp" }),
    viewSwitch(),
    addTopButton(),
  )
  let body: Node
  if (error) body = errorBox()
  else if (!board) body = el("p", { class: "sp-empty" }, "Загружаю…")
  else if (view === "lists") body = boardView()
  else body = agendaView()
  const hidden = board?.prefs.hidden.filter((id) => findList(id)).length ?? 0
  const foot =
    hidden && view === "lists"
      ? el(
          "p",
          { class: "sp-foot" },
          showHidden ? "Показаны скрытые списки · " : `Скрыто списков: ${hidden} · `,
          button("sp-link", showHidden ? "спрятать" : "показать", () => {
            showHidden = !showHidden
            render()
          }),
        )
      : null
  const scroll = root.querySelector<HTMLElement>(".sp-board")?.scrollLeft ?? 0
  root.replaceChildren(
    el("div", { class: "sp-tasks" }, head, body, foot),
    ...(sel ? [detail()] : []),
  )
  const b = root.querySelector<HTMLElement>(".sp-board")
  if (b) b.scrollLeft = scroll
  root.querySelector<HTMLInputElement>(".sp-add-input")?.focus()
  root.classList.toggle("has-detail", !!sel)
}

function button(
  cls: string,
  html: string,
  onClick: (e: MouseEvent) => void,
  attrs: Record<string, string> = {},
) {
  const b = el("button", { type: "button", class: cls, ...attrs, html })
  b.addEventListener("click", (e) => {
    e.stopPropagation()
    onClick(e as MouseEvent)
  })
  return b
}

function viewSwitch() {
  const seg = el("div", { class: "sp-seg", role: "tablist", "aria-label": "Вид" })
  for (const [v, label] of [
    ["lists", "Списки"],
    ["today", "Сегодня"],
    ["week", "Неделя"],
  ] as const) {
    seg.append(
      button(
        view === v ? "on" : "",
        label,
        () => {
          view = v
          store.set("kb-tasks-view", v)
          render()
        },
        { role: "tab", "aria-selected": String(view === v) },
      ),
    )
  }
  return seg
}

function addTopButton() {
  return button("sp-btn primary", `${svg("plus")}<span>Задача</span>`, () => {
    const first =
      visibleLists().find((l) => !board!.prefs.collapsed.includes(l.id)) ?? visibleLists()[0]
    if (!first) return
    view = "lists"
    adding = first.id
    render()
  })
}

function errorBox() {
  const e = error!
  if (e.status === 409)
    return el(
      "div",
      { class: "sp-empty" },
      el("p", {}, "Google Tasks не подключён."),
      button(
        "sp-btn primary",
        "Подключить",
        () =>
          (location.href = new URL(
            "api/gtasks/connect",
            new URL(siteRoot, location.href),
          ).toString()),
      ),
    )
  if (e.status === 401)
    return el(
      "p",
      { class: "sp-empty" },
      "Нужно войти. ",
      el("a", { href: loginUrl() }, "Войти через GitHub"),
    )
  if (e.status === 501)
    return el("p", { class: "sp-empty" }, "Google Tasks не настроен на сервере.")
  return el(
    "div",
    { class: "sp-empty" },
    el("p", {}, `Не удалось загрузить задачи: ${e.message}`),
    button("sp-btn", "Повторить", () => load()),
  )
}

/* ── колонки ── */

function boardView() {
  const wrap = el("div", { class: "sp-board" })
  for (const l of visibleLists()) wrap.append(column(l))
  if (!visibleLists().length) wrap.append(el("p", { class: "sp-empty" }, "Списков нет."))
  return wrap
}

function column(l: List) {
  const collapsed = board!.prefs.collapsed.includes(l.id)
  const hidden = board!.prefs.hidden.includes(l.id)
  const open = l.tasks.filter((t) => !t.done)
  const done = l.tasks.filter((t) => t.done)
  const col = el("section", {
    class: `sp-col${collapsed ? " collapsed" : ""}${hidden ? " is-hidden" : ""}`,
    "data-list": l.id,
  })
  const grip = el("span", { class: "sp-col-grip", title: "Перетащить список", html: svg("grip") })
  grip.addEventListener("pointerdown", (e) => dragList(e as PointerEvent, l.id, col))
  const title = el(
    "button",
    { type: "button", class: "sp-col-t", "aria-expanded": String(!collapsed) },
    el("span", { class: "sp-col-name" }, l.title),
    el("span", { class: "sp-col-n" }, String(open.length || "")),
    el("span", { class: "sp-col-chev", html: svg("chev") }),
  )
  title.addEventListener("click", () => toggleCollapse(l.id))
  const menu = button("sp-icon", svg("more"), (e) => listMenu(e, l), {
    "aria-label": `Меню списка «${l.title}»`,
  })
  col.append(el("header", { class: "sp-col-h" }, grip, title, menu))
  if (collapsed) return col

  const ul = el("ul", { class: "sp-rows", "data-list": l.id })
  for (const t of topLevel(l).filter((t) => !t.done)) {
    ul.append(taskRow(l, t, true))
    for (const ch of childrenOf(l, t.id).filter((x) => !x.done)) ul.append(taskRow(l, ch, false))
  }
  col.append(ul)

  if (adding === l.id) col.append(addForm(l))
  else
    col.append(
      button("sp-add", `${svg("plus")}<span>Добавить</span>`, () => {
        adding = l.id
        render()
      }),
    )

  if (done.length) {
    const showing = showDone.has(l.id)
    col.append(
      button(
        "sp-done-t",
        `<span>Выполнено · ${done.length}</span>${svg("chev", showing ? "up" : "")}`,
        () => {
          showing ? showDone.delete(l.id) : showDone.add(l.id)
          render()
        },
      ),
    )
    if (showing) {
      const dl = el("ul", { class: "sp-rows done" })
      for (const t of [...done]
        .sort((a, b) => String(b.completed).localeCompare(String(a.completed)))
        .slice(0, 50))
        dl.append(taskRow(l, t, false))
      col.append(dl)
    }
  }
  return col
}

function taskRow(l: List, t: Task, top: boolean, withList = false) {
  const li = el("li", {
    class: `sp-task${top ? " top" : " child"}${t.done ? " is-done" : ""}${sel?.id === t.id ? " on" : ""}`,
    "data-id": t.id,
    "data-list": l.id,
  })
  const check = button("sp-check", svg("check"), () => toggleDone(l, t), {
    "aria-label": t.done ? "Вернуть в работу" : "Отметить выполненной",
    "aria-pressed": String(t.done),
  })
  const due = dueInfo(t.due)
  const meta: Node[] = []
  if (due) meta.push(el("span", { class: `sp-due ${t.done ? "" : due.cls}` }, due.label))
  if (withList) meta.push(el("span", { class: "sp-meta-i" }, l.title))
  if (t.note)
    meta.push(
      el("span", { class: "sp-meta-i", html: `${svg("file")}${escapeHtml(noteTitle(t.note))}` }),
    )
  if (t.notes && !withList) meta.push(el("span", { class: "sp-meta-i dim" }, "есть описание"))
  const main = el(
    "button",
    { type: "button", class: "sp-task-main" },
    el("span", { class: "sp-task-t" }, t.title),
    meta.length ? el("span", { class: "sp-task-meta" }, ...meta) : null,
  )
  main.addEventListener("click", () => {
    sel = { listId: l.id, id: t.id }
    render()
  })
  li.append(check, main)
  if (top && !t.done && view === "lists") {
    const grip = el("span", { class: "sp-grip", title: "Перетащить", html: svg("grip") })
    grip.addEventListener("pointerdown", (e) => dragTask(e as PointerEvent, l.id, t.id, li))
    li.append(grip)
  }
  return li
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
const noteTitle = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "")

function addForm(l: List, due: string | null = null) {
  const input = el("input", {
    class: "sp-add-input",
    placeholder: "Новая задача",
    "aria-label": `Новая задача в «${l.title}»`,
  }) as HTMLInputElement
  const form = el("form", { class: "sp-add-form" }, input)
  const submit = async () => {
    const title = input.value.trim()
    if (!title) {
      adding = null
      return render()
    }
    input.value = ""
    const tmp: Task = {
      id: `tmp-${Date.now()}`,
      title,
      notes: "",
      due,
      done: false,
      completed: null,
      parent: null,
      note: null,
    }
    const tops = topLevel(l).filter((t) => !t.done)
    const last = tops[tops.length - 1]
    // в Google новая задача встаёт после последней открытой
    l.tasks.push(tmp)
    await act(async () => {
      const created = await call<any>("POST", "gtasks/task", {
        listId: l.id,
        title,
        due,
        previous: last?.id,
      })
      Object.assign(tmp, { id: created.id })
      render()
    })
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    submit()
  })
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      adding = null
      render()
    }
  })
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (adding === l.id && !input.value.trim() && document.activeElement !== input) {
        adding = null
        render()
      }
    }, 150)
  })
  return form
}

function toggleDone(l: List, t: Task) {
  t.done = !t.done
  t.completed = t.done ? new Date().toISOString() : null
  act(() => call("PATCH", "gtasks/task", { listId: l.id, id: t.id, done: t.done }))
}

function toggleCollapse(id: string) {
  const c = board!.prefs.collapsed
  board!.prefs.collapsed = c.includes(id) ? c.filter((x) => x !== id) : [...c, id]
  render()
  savePrefs()
}

function listMenu(e: MouseEvent, l: List) {
  document.querySelector(".sp-menu")?.remove()
  const hidden = board!.prefs.hidden.includes(l.id)
  const collapsed = board!.prefs.collapsed.includes(l.id)
  const menu = el("div", { class: "sp-menu", role: "menu" })
  const item = (label: string, fn: () => void) => {
    const b = el("button", { type: "button", role: "menuitem" }, label)
    b.addEventListener("click", () => {
      menu.remove()
      fn()
    })
    menu.append(b)
  }
  item(collapsed ? "Развернуть" : "Свернуть", () => toggleCollapse(l.id))
  item(hidden ? "Показать список" : "Скрыть список", () => {
    const h = board!.prefs.hidden
    board!.prefs.hidden = hidden ? h.filter((x) => x !== l.id) : [...h, l.id]
    if (!hidden) ctx.flash(`Список «${l.title}» скрыт — вернуть можно внизу страницы`)
    render()
    savePrefs()
  })
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menu.style.top = `${r.bottom + 4}px`
  menu.style.left = `${Math.max(8, Math.min(innerWidth - 188, r.right - 180))}px`
  document.body.append(menu)
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0)
}

/* ── «Сегодня» и «Неделя» ── */

function agendaView() {
  const today = addDays(0)
  const end = addDays(view === "today" ? 0 : 6)
  const groups = new Map<string, { l: List; t: Task }[]>()
  const push = (k: string, v: { l: List; t: Task }) => {
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(v)
  }
  for (const l of visibleLists())
    for (const t of l.tasks)
      if (!t.done && t.due && t.due <= end) push(t.due < today ? "late" : t.due, { l, t })
  const keys = [...groups.keys()].sort((a, b) =>
    a === "late" ? -1 : b === "late" ? 1 : a.localeCompare(b),
  )
  const wrap = el("div", { class: "sp-agenda" })
  if (!keys.length) {
    wrap.append(
      el(
        "p",
        { class: "sp-empty" },
        view === "today" ? "На сегодня задач со сроком нет." : "На неделю задач со сроком нет.",
      ),
    )
  }
  for (const k of keys) {
    const label =
      k === "late"
        ? "Просрочено"
        : k === today
          ? "Сегодня"
          : k === addDays(1)
            ? "Завтра"
            : new Date(`${k}T12:00:00`).toLocaleDateString("ru-RU", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
    const ul = el("ul", { class: "sp-rows" })
    for (const { l, t } of groups.get(k)!) ul.append(taskRow(l, t, false, true))
    wrap.append(
      el(
        "section",
        { class: `sp-col agenda${k === "late" ? " late" : ""}` },
        el("header", { class: "sp-col-h" }, el("span", { class: "sp-col-name" }, label)),
        ul,
      ),
    )
  }
  return wrap
}

/* ── карточка задачи ── */

function detail() {
  const l = findList(sel!.listId)
  const t = l && findTask(l.id, sel!.id)
  if (!l || !t) {
    sel = null
    return el("span")
  }
  const close = () => {
    sel = null
    render()
  }
  const patch = (p: Record<string, unknown>) =>
    act(() => call("PATCH", "gtasks/task", { listId: l.id, id: t.id, ...p }))

  const title = el("textarea", {
    class: "sp-d-title",
    rows: "1",
    "aria-label": "Название",
  }) as HTMLTextAreaElement
  title.value = t.title
  const grow = () => {
    title.style.height = "auto"
    title.style.height = `${title.scrollHeight}px`
  }
  title.addEventListener("input", grow)
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      title.blur()
    }
  })
  title.addEventListener("change", () => {
    const v = title.value.trim()
    if (v && v !== t.title) {
      t.title = v
      patch({ title: v })
    } else title.value = t.title
  })
  requestAnimationFrame(grow)

  const date = el("input", {
    type: "date",
    class: "sp-d-date",
    "aria-label": "Срок",
  }) as HTMLInputElement
  date.value = t.due ?? ""
  const setDue = (v: string | null) => {
    t.due = v
    patch({ due: v })
  }
  date.addEventListener("change", () => setDue(date.value || null))

  const listSel = el("select", {
    class: "sp-d-select",
    "aria-label": "Список",
  }) as HTMLSelectElement
  for (const x of board!.lists)
    listSel.append(el("option", { value: x.id, selected: x.id === l.id }, x.title))
  listSel.addEventListener("change", () => {
    const to = findList(listSel.value)
    if (!to) return
    moveLocal(
      l.id,
      t.id,
      to.id,
      topLevel(to)
        .filter((x) => !x.done)
        .pop()?.id ?? null,
    )
    sel = { listId: to.id, id: t.id }
    act(() =>
      call("POST", "gtasks/move", { listId: l.id, id: t.id, toListId: to.id, previous: null }),
    )
  })

  const notes = el("textarea", {
    class: "sp-d-notes",
    rows: "4",
    placeholder: "Описание",
    "aria-label": "Описание",
  }) as HTMLTextAreaElement
  notes.value = t.notes
  notes.addEventListener("change", () => {
    if (notes.value !== t.notes) {
      t.notes = notes.value
      patch({ notes: notes.value })
    }
  })

  const kids = childrenOf(l, t.id)
  const panel = el(
    "aside",
    { class: "sp-detail", "aria-label": "Задача" },
    el(
      "div",
      { class: "sp-d-head" },
      button(`sp-check${t.done ? " is-on" : ""}`, svg("check"), () => toggleDone(l, t), {
        "aria-label": "Выполнено",
      }),
      title,
      button("sp-icon", svg("x"), close, { "aria-label": "Закрыть" }),
    ),
    el(
      "div",
      { class: "sp-d-row" },
      el("span", { class: "sp-d-l" }, "Срок"),
      el(
        "div",
        { class: "sp-d-v" },
        date,
        button("sp-chip", "Сегодня", () => setDue(addDays(0))),
        button("sp-chip", "Завтра", () => setDue(addDays(1))),
        t.due ? button("sp-chip", "Убрать", () => setDue(null)) : null,
      ),
    ),
    el(
      "div",
      { class: "sp-d-row" },
      el("span", { class: "sp-d-l" }, "Список"),
      el("div", { class: "sp-d-v" }, listSel),
    ),
    t.note
      ? el(
          "div",
          { class: "sp-d-row" },
          el("span", { class: "sp-d-l" }, "Заметка"),
          el(
            "div",
            { class: "sp-d-v" },
            el(
              "a",
              { href: new URL(slugify(t.note), new URL(siteRoot, location.href)).toString() },
              `${noteTitle(t.note)} ↗`,
            ),
          ),
        )
      : null,
    notes,
    kids.length
      ? el(
          "div",
          { class: "sp-d-kids" },
          el(
            "div",
            { class: "sp-d-l" },
            `Подзадачи · ${kids.filter((k) => k.done).length} из ${kids.length}`,
          ),
          el("ul", { class: "sp-rows" }, ...kids.map((k) => taskRow(l, k, false))),
        )
      : null,
    el(
      "div",
      { class: "sp-d-foot" },
      button("sp-btn danger", `${svg("trash")}<span>Удалить</span>`, () => {
        if (!confirm(`Удалить задачу «${t.title}»?`)) return
        l.tasks = l.tasks.filter((x) => x.id !== t.id && x.parent !== t.id)
        sel = null
        act(() => call("DELETE", "gtasks/task", { listId: l.id, id: t.id }))
      }),
    ),
  )
  const back = el("div", { class: "sp-detail-back" })
  back.addEventListener("click", close)
  return el("div", { class: "sp-detail-wrap" }, back, panel)
}

/* ───── перетаскивание ───── */

/** Переносит задачу (вместе с подзадачами) в списке на экране. */
function moveLocal(fromId: string, id: string, toId: string, previous: string | null) {
  const from = findList(fromId)!
  const to = findList(toId)!
  const moving = from.tasks.filter((t) => t.id === id || t.parent === id)
  from.tasks = from.tasks.filter((t) => !moving.includes(t))
  let at = 0
  if (previous) {
    const i = to.tasks.findIndex((t) => t.id === previous)
    at = i + 1
    while (at < to.tasks.length && to.tasks[at].parent === previous) at++
  }
  to.tasks.splice(at, 0, ...moving)
}

function autoScroll(e: PointerEvent) {
  const edge = 60
  if (e.clientY < edge) scrollBy(0, -12)
  else if (e.clientY > innerHeight - edge) scrollBy(0, 12)
  const b = root?.querySelector<HTMLElement>(".sp-board")
  if (b && getComputedStyle(b).flexDirection === "row") {
    const r = b.getBoundingClientRect()
    if (e.clientX < r.left + edge) b.scrollLeft -= 14
    else if (e.clientX > r.right - edge) b.scrollLeft += 14
  }
}

function startGhost(e: PointerEvent, node: HTMLElement) {
  const r = node.getBoundingClientRect()
  const ghost = node.cloneNode(true) as HTMLElement
  ghost.classList.add("sp-ghost")
  Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` })
  document.body.append(ghost)
  const dx = e.clientX - r.left
  const dy = e.clientY - r.top
  return {
    ghost,
    move(ev: PointerEvent) {
      ghost.style.left = `${ev.clientX - dx}px`
      ghost.style.top = `${ev.clientY - dy}px`
    },
    rect: r,
  }
}

function dragTask(e: PointerEvent, listId: string, id: string, li: HTMLElement) {
  if (e.button !== 0) return
  e.preventDefault()
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture(e.pointerId)
  dragging = true
  document.documentElement.classList.add("sp-dragging")
  const g = startGhost(e, li)
  const drop = el("li", { class: "sp-drop" })
  drop.style.height = `${g.rect.height}px`
  // вместе с задачей прячем её подзадачи
  const kids: HTMLElement[] = []
  let n = li.nextElementSibling as HTMLElement | null
  while (n && n.classList.contains("child")) {
    kids.push(n)
    n = n.nextElementSibling as HTMLElement | null
  }
  li.after(drop)
  for (const x of [li, ...kids]) x.style.display = "none"

  const place = (ev: PointerEvent) => {
    const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
    const col = under?.closest<HTMLElement>(".sp-col:not(.collapsed):not(.agenda)")
    const ul = col?.querySelector<HTMLElement>(".sp-rows:not(.done)")
    if (!ul) return
    const rows = [...ul.querySelectorAll<HTMLElement>(":scope > .sp-task.top")].filter(
      (x) => x.style.display !== "none",
    )
    const before = rows.find((r) => {
      const b = r.getBoundingClientRect()
      return ev.clientY < b.top + b.height / 2
    })
    if (before) ul.insertBefore(drop, before)
    else ul.append(drop)
  }
  const move = (ev: PointerEvent) => {
    g.move(ev)
    place(ev)
    autoScroll(ev)
  }
  const up = () => {
    grip.removeEventListener("pointermove", move)
    grip.removeEventListener("pointerup", up)
    grip.removeEventListener("pointercancel", up)
    g.ghost.remove()
    document.documentElement.classList.remove("sp-dragging")
    const ul = drop.parentElement
    const toId = ul?.dataset.list ?? listId
    let prev = drop.previousElementSibling as HTMLElement | null
    while (prev && !prev.classList.contains("top"))
      prev = prev.previousElementSibling as HTMLElement | null
    const previous = prev && prev.dataset.id !== id ? prev.dataset.id! : null
    drop.remove()
    dragging = false
    const list = findList(listId)!
    const tops = topLevel(list).filter((t) => !t.done)
    const oldPrev = tops[tops.findIndex((t) => t.id === id) - 1]?.id ?? null
    if (toId === listId && previous === oldPrev) return render()
    moveLocal(listId, id, toId, previous)
    if (sel?.id === id) sel = { listId: toId, id }
    act(() =>
      call("POST", "gtasks/move", {
        listId,
        id,
        previous,
        toListId: toId !== listId ? toId : undefined,
      }),
    )
  }
  grip.addEventListener("pointermove", move)
  grip.addEventListener("pointerup", up)
  grip.addEventListener("pointercancel", up)
}

function dragList(e: PointerEvent, _id: string, col: HTMLElement) {
  if (e.button !== 0) return
  e.preventDefault()
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture(e.pointerId)
  dragging = true
  document.documentElement.classList.add("sp-dragging")
  const boardEl = col.parentElement!
  const horizontal = getComputedStyle(boardEl).flexDirection === "row"
  const g = startGhost(e, col)
  const drop = el("div", { class: "sp-col-drop" })
  drop.style[horizontal ? "width" : "height"] =
    `${horizontal ? g.rect.width : Math.min(g.rect.height, 56)}px`
  col.after(drop)
  col.style.display = "none"
  const move = (ev: PointerEvent) => {
    g.move(ev)
    autoScroll(ev)
    const cols = [...boardEl.querySelectorAll<HTMLElement>(":scope > .sp-col")].filter(
      (c) => c !== col,
    )
    const before = cols.find((c) => {
      const r = c.getBoundingClientRect()
      return horizontal ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2
    })
    if (before) boardEl.insertBefore(drop, before)
    else boardEl.append(drop)
  }
  const up = () => {
    grip.removeEventListener("pointermove", move)
    grip.removeEventListener("pointerup", up)
    grip.removeEventListener("pointercancel", up)
    g.ghost.remove()
    document.documentElement.classList.remove("sp-dragging")
    drop.replaceWith(col)
    col.style.display = ""
    dragging = false
    const shown = [...boardEl.querySelectorAll<HTMLElement>(":scope > .sp-col")].map(
      (c) => c.dataset.list!,
    )
    // скрытые списки сохраняют свои места среди остальных
    const all = board!.lists.map((l) => l.id)
    const rest = all.filter((x) => !shown.includes(x))
    const order = [...shown]
    for (const h of rest) order.splice(Math.min(all.indexOf(h), order.length), 0, h)
    board!.prefs.order = order
    const rank = new Map(order.map((x, i) => [x, i]))
    board!.lists.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    render()
    savePrefs()
  }
  grip.addEventListener("pointermove", move)
  grip.addEventListener("pointerup", up)
  grip.addEventListener("pointercancel", up)
}
