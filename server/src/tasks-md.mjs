// Задачи в заметках Obsidian: разбор и запись строк вида
//   - [ ] Купить молоко 📅 2026-11-10 %%gt:abc123%%
//   - [x] Сдать отчёт ✅ 2026-11-07 %%gt:def456%%
// Формат совместим с плагином Obsidian Tasks (📅 — срок, ✅ — дата выполнения).
// %%gt:…%% — комментарий Obsidian со связью с задачей в Google Tasks: в режиме чтения
// и на сайте он не виден.

const LINE = /^(\s*)[-*+] \[([ xX])\] (.*)$/
const ID = /\s*%%gt:([\w-]+)%%/
const DUE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/
const DONE = /\s*✅\s*(\d{4}-\d{2}-\d{2})/

/** Убирает тег из названия (для Google), не трогая остальной текст. */
export function stripTag(text, tag) {
  if (!tag) return text.trim()
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text
    .replace(new RegExp(`(^|\\s)${esc}(?=\\s|$)`, "gu"), " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export function hasTag(text, tag) {
  if (!tag) return false
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|\\s)${esc}(?=\\s|$)`, "u").test(text)
}

/**
 * Разбирает строку-задачу. Возвращает null, если это не задача.
 * title — текст без служебных отметок (тег остаётся, его убирает stripTag).
 */
export function parseTaskLine(line) {
  const m = LINE.exec(line)
  if (!m) return null
  let body = m[3]
  const id = ID.exec(body)?.[1] ?? null
  body = body.replace(ID, "")
  const due = DUE.exec(body)?.[1] ?? null
  body = body.replace(DUE, "")
  const doneDate = DONE.exec(body)?.[1] ?? null
  body = body.replace(DONE, "")
  return {
    indent: m[1],
    done: m[2] !== " ",
    text: body.trim(),
    due,
    doneDate,
    id,
  }
}

/** Собирает строку обратно. */
export function formatTaskLine({ indent = "", done, text, due, doneDate, id }) {
  let s = `${indent}- [${done ? "x" : " "}] ${text.trim()}`
  if (due) s += ` 📅 ${due}`
  if (done && doneDate) s += ` ✅ ${doneDate}`
  if (id) s += ` %%gt:${id}%%`
  return s
}

/** Строки внутри ``` и ~~~ блоков кода — не задачи. */
export function taskLines(content) {
  const lines = content.split("\n")
  const out = []
  let fence = null
  let inFrontmatter = lines[0]?.trim() === "---"
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (inFrontmatter) {
      if (i > 0 && l.trim() === "---") inFrontmatter = false
      continue
    }
    const f = /^\s*(```|~~~)/.exec(l)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1] === fence) fence = null
      continue
    }
    if (fence) continue
    const t = parseTaskLine(l)
    if (t) out.push({ ...t, line: i })
  }
  return out
}

/** Дата YYYY-MM-DD → формат Google Tasks (время Google всё равно отбрасывает). */
export function toGoogleDue(d) {
  return d ? `${d}T00:00:00.000Z` : null
}
export function fromGoogleDate(s) {
  return s ? String(s).slice(0, 10) : null
}

/** Имя файла заметки для списка Google: без символов, запрещённых в путях. */
export function listFileName(title) {
  const clean = String(title || "Задачи")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*#%^[\]\\/]+/g, " ")
    .replace(/^\.+/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 80)
  return clean || "Задачи"
}
