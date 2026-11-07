// Inbox.md — один файл со списком мыслей:
//
//   # Inbox
//
//   - 2026-11-07 09:12 Пет-проект: бот с вопросом каждое утро
//   - 2026-11-07 08:40 Почитать про виртуальные потоки
//     вторая строка той же мысли — с отступом
//
// Новые мысли добавляются сверху (под заголовком). Дата необязательна: строки,
// написанные в Obsidian руками, тоже считаются мыслями.

import { createHash } from "node:crypto"

const ITEM = /^[-*+] (.*)$/
const STAMP = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\s+([\s\S]*)$/

export const INBOX_TEMPLATE = "# Inbox\n\n"

const idOf = (raw, n) =>
  createHash("sha1").update(`${n}\u0000${raw}`).digest("base64url").slice(0, 12)

/** Разбирает файл: шапка (всё до первого пункта), пункты, хвост не теряется. */
export function parseInbox(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const items = []
  let cur = null
  const seen = new Map()
  const flush = () => {
    if (!cur) return
    const raw = cur.lines.join("\n")
    const n = (seen.get(raw) ?? 0) + 1
    seen.set(raw, n)
    const first = cur.lines[0].replace(ITEM, "$1")
    const rest = cur.lines.slice(1).map((l) => l.replace(/^(\t| {2,4})/, ""))
    const body = [first, ...rest].join("\n").trimEnd()
    const m = STAMP.exec(body)
    items.push({
      id: idOf(raw, n),
      date: m ? m[1] : null,
      time: m?.[2] ?? null,
      text: m ? m[3] : body,
      start: cur.start,
      end: cur.start + cur.lines.length,
    })
    cur = null
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (ITEM.test(l)) {
      flush()
      cur = { start: i, lines: [l] }
    } else if (
      cur &&
      (/^(\t| {2,})\S/.test(l) || (l === "" && /^(\t| {2,})\S/.test(lines[i + 1] ?? "")))
    ) {
      cur.lines.push(l)
    } else flush()
  }
  flush()
  return { lines, items }
}

/** Пункт списка из даты и текста; многострочный текст — с отступом. */
export function formatItem({ date, time, text }) {
  const body = String(text).replace(/\r\n/g, "\n").trim()
  const [first, ...rest] = body.split("\n")
  const head = date ? `${date}${time ? ` ${time}` : ""} ${first}` : first
  return [`- ${head}`, ...rest.map((l) => (l.trim() ? `  ${l}` : ""))].join("\n")
}

/** Добавляет мысль первой в списке (после заголовка). */
export function addItem(content, item) {
  const src = content && content.trim() ? content.replace(/\r\n/g, "\n") : INBOX_TEMPLATE
  const { lines, items } = parseInbox(src)
  const text = formatItem(item)
  if (items.length) {
    lines.splice(items[0].start, 0, ...text.split("\n"))
  } else {
    // после заголовка: убираем пустые строки в конце, одна пустая — и пункт
    while (lines.length && lines[lines.length - 1] === "") lines.pop()
    lines.push("", ...text.split("\n"))
  }
  return ensureNewline(lines.join("\n"))
}

export function updateItem(content, id, text) {
  const { lines, items } = parseInbox(content)
  const it = items.find((x) => x.id === id)
  if (!it) return null
  const next = formatItem({ date: it.date, time: it.time, text }).split("\n")
  lines.splice(it.start, it.end - it.start, ...next)
  return ensureNewline(lines.join("\n"))
}

export function removeItem(content, id) {
  const { lines, items } = parseInbox(content)
  const it = items.find((x) => x.id === id)
  if (!it) return null
  lines.splice(it.start, it.end - it.start)
  return ensureNewline(lines.join("\n").replace(/\n{3,}/g, "\n\n"))
}

function ensureNewline(s) {
  return s.endsWith("\n") ? s : s + "\n"
}

/** Публичное представление пунктов для клиента. */
export function publicItems(content) {
  return parseInbox(content).items.map(({ id, date, time, text }) => ({ id, date, time, text }))
}
