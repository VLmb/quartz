// Inbox: один файл Inbox.md со списком мыслей. Здесь — удобный вид поверх него:
// поле «Записать мысль», список по дням, мысль раскрывается для правки и удаления.
import { call, HttpError, loginUrl } from "./api"
import { el, store } from "../editor/util"

type Item = {
  id: string
  date: string | null
  time: string | null
  text: string
  pending?: boolean
}
export type Ctx = { flash: (msg: string) => void }

const QUEUE = "kb-inbox-queue"
let items: Item[] = []
let root: HTMLElement | null = null
let listEl: HTMLElement | null = null
let countEl: HTMLElement | null = null
let openId: string | null = null
let ctx: Ctx = { flash: () => {} }
let loaded = false

const pad = (n: number) => String(n).padStart(2, "0")
function stamp(d = new Date()) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function dayLabel(date: string | null): string {
  if (!date) return "Без даты"
  const today = stamp().date
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (date === today) return "Сегодня"
  if (date === stamp(y).date) return "Вчера"
  const d = new Date(`${date}T12:00:00`)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

function autosize(t: HTMLTextAreaElement) {
  t.style.height = "auto"
  t.style.height = `${t.scrollHeight}px`
}

/* ───── очередь без сети ───── */

type Queued = { text: string; at: string }
const queue = () => store.get<Queued[]>(QUEUE) ?? []

async function flushQueue() {
  let q = queue()
  while (q.length) {
    try {
      const r = await call<{ items: Item[] }>("POST", "inbox", q[0])
      items = r.items
    } catch (e) {
      if ((e as HttpError).status === 0) return
      ctx.flash(`Мысль из очереди не сохранилась: ${(e as Error).message}`)
    }
    q = q.slice(1)
    store.set(QUEUE, q)
  }
}

/** Записать мысль (из поля на странице или из быстрого окна). */
export async function addThought(text: string): Promise<boolean> {
  const t = text.trim()
  if (!t) return false
  const s = stamp()
  const at = `${s.date} ${s.time}`
  const temp: Item = { id: `tmp-${Date.now()}`, date: s.date, time: s.time, text: t, pending: true }
  items = [temp, ...items]
  render()
  try {
    const r = await call<{ items: Item[] }>("POST", "inbox", { text: t, at })
    items = r.items
    render()
    return true
  } catch (e) {
    if ((e as HttpError).status === 0) {
      store.set(QUEUE, [...queue(), { text: t, at }])
      ctx.flash("Нет сети — мысль сохранена на устройстве и уйдёт, когда сеть появится")
      return true
    }
    items = items.filter((x) => x !== temp)
    render()
    ctx.flash((e as Error).message)
    return false
  }
}

/* ───── страница ───── */

export function mount(container: HTMLElement, c: Ctx) {
  root = container
  ctx = c
  openId = null
  loaded = false
  const input = el("textarea", {
    class: "sp-input",
    rows: "1",
    placeholder: "Записать мысль…",
    "aria-label": "Новая мысль",
  }) as HTMLTextAreaElement
  const addBtn = el("button", { type: "button", class: "sp-btn primary" }, "Добавить")
  const submit = async () => {
    const v = input.value
    if (!v.trim()) return input.focus()
    input.value = ""
    autosize(input)
    if (!(await addThought(v))) input.value = v
    input.focus()
  }
  input.addEventListener("input", () => autosize(input))
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  })
  addBtn.addEventListener("click", submit)
  countEl = el("span", { class: "sp-count" })
  listEl = el("div", { class: "sp-inbox-list", "aria-live": "polite" })
  root.replaceChildren(
    el(
      "div",
      { class: "sp-inbox" },
      el("div", { class: "sp-head" }, el("h1", { class: "sp-title" }, "Inbox"), countEl),
      el("div", { class: "sp-compose" }, input, addBtn),
      listEl,
    ),
  )
  root.closest(".space-view")?.classList.add("ready")
  render()
  load()
  addEventListener("online", onOnline)
}

export function unmount() {
  removeEventListener("online", onOnline)
  root = listEl = countEl = null
}

const onOnline = () => flushQueue().then(render)

async function load() {
  try {
    const r = await call<{ items: Item[] }>("GET", "inbox")
    items = r.items
    loaded = true
    await flushQueue()
    render()
  } catch (e) {
    loaded = true
    const err = e as HttpError
    if (!listEl) return
    if (err.status === 401) {
      listEl.replaceChildren(
        el(
          "p",
          { class: "sp-empty" },
          "Чтобы видеть и править Inbox, войдите через GitHub. ",
          el("a", { href: loginUrl() }, "Войти"),
        ),
      )
    } else {
      listEl.replaceChildren(el("p", { class: "sp-empty" }, `Не удалось загрузить: ${err.message}`))
    }
  }
}

function render() {
  if (!listEl) return
  const pending = queue().length
  if (countEl) countEl.textContent = items.length ? String(items.length) : ""
  if (!loaded) {
    listEl.replaceChildren(el("p", { class: "sp-empty" }, "Загружаю…"))
    return
  }
  if (!items.length) {
    listEl.replaceChildren(
      el("p", { class: "sp-empty" }, "Пусто. Запиши первую мысль — она попадёт в Inbox.md."),
    )
    return
  }
  const groups = new Map<string, Item[]>()
  for (const it of items) {
    const k = dayLabel(it.date)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(it)
  }
  const out: Node[] = []
  for (const [label, list] of groups) {
    out.push(
      el(
        "section",
        { class: "sp-day" },
        el("h2", { class: "sp-day-t" }, label),
        ...list.map((it) => (it.id === openId ? editor(it) : row(it))),
      ),
    )
  }
  if (pending) out.unshift(el("p", { class: "sp-note" }, `Ждут сети: ${pending}`))
  listEl.replaceChildren(...out)
  const ta = listEl.querySelector<HTMLTextAreaElement>(".sp-edit textarea")
  if (ta) {
    autosize(ta)
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }
}

function row(it: Item): HTMLElement {
  const b = el(
    "button",
    { type: "button", class: `sp-item${it.pending ? " pending" : ""}`, disabled: !!it.pending },
    el("span", { class: "sp-item-t" }, it.text),
    el("span", { class: "sp-item-m" }, it.pending ? "сохраняю…" : (it.time ?? "")),
  )
  b.addEventListener("click", () => {
    openId = it.id
    render()
  })
  return b
}

function editor(it: Item): HTMLElement {
  const ta = el("textarea", { rows: "2", "aria-label": "Текст мысли" }) as HTMLTextAreaElement
  ta.value = it.text
  ta.addEventListener("input", () => autosize(ta))
  const del = el("button", { type: "button", class: "sp-btn danger" }, "Удалить")
  const done = el("button", { type: "button", class: "sp-btn" }, "Готово")
  const close = () => {
    openId = null
    render()
  }
  const save = async () => {
    const v = ta.value.trim()
    if (v === it.text.trim()) return close()
    if (!v) return remove()
    done.setAttribute("disabled", "")
    try {
      const r = await call<{ items: Item[] }>("PUT", "inbox", { id: it.id, text: v })
      items = r.items
      close()
    } catch (e) {
      done.removeAttribute("disabled")
      ctx.flash((e as Error).message)
      if ((e as HttpError).status === 409) load()
    }
  }
  const remove = async () => {
    if (!confirm("Удалить эту мысль из Inbox?")) return
    try {
      const r = await call<{ items: Item[] }>("DELETE", "inbox", { id: it.id })
      items = r.items
      close()
    } catch (e) {
      ctx.flash((e as Error).message)
      if ((e as HttpError).status === 409) load()
    }
  }
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
  })
  del.addEventListener("click", remove)
  done.addEventListener("click", save)
  return el(
    "div",
    { class: "sp-edit" },
    ta,
    el(
      "div",
      { class: "sp-edit-foot" },
      el("span", { class: "sp-item-m" }, [it.date, it.time].filter(Boolean).join(" ")),
      del,
      done,
    ),
  )
}

/* ───── быстрая запись с любой страницы (клавиша I, кнопка «+» на телефоне) ───── */

let captureEl: HTMLElement | null = null

export function openCapture(c: Ctx) {
  ctx = c
  if (captureEl) return
  const ta = el("textarea", {
    rows: "3",
    placeholder: "Что в голове?",
    "aria-label": "Новая мысль",
  }) as HTMLTextAreaElement
  const save = el("button", { type: "button", class: "sp-btn primary wide" }, "Сохранить в Inbox")
  const close = () => {
    captureEl?.remove()
    captureEl = null
    document.documentElement.classList.remove("sp-capture-open")
  }
  const submit = async () => {
    const v = ta.value.trim()
    if (!v) return ta.focus()
    save.setAttribute("disabled", "")
    const ok = await addThought(v)
    save.removeAttribute("disabled")
    if (ok) {
      close()
      ctx.flash("Сохранено в Inbox")
    }
  }
  ta.addEventListener("input", () => autosize(ta))
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  })
  save.addEventListener("click", submit)
  const back = el("div", { class: "sp-capture-back" })
  back.addEventListener("click", close)
  captureEl = el(
    "div",
    { class: "sp-capture-wrap" },
    back,
    el(
      "div",
      { class: "sp-capture", role: "dialog", "aria-label": "Новая мысль" },
      el("div", { class: "sp-grab" }),
      ta,
      save,
    ),
  )
  document.body.appendChild(captureEl)
  document.documentElement.classList.add("sp-capture-open")
  requestAnimationFrame(() => ta.focus())
}

export function captureOpen() {
  return !!captureEl
}
