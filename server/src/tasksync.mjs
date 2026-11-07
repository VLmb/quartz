// Двусторонняя синхронизация задач из заметок с Google Tasks.
//
// Какие строки считаются задачами:
//   • все чекбоксы в заметках папки «Задачи/» (заметка «Задачи/Работа.md» = список «Работа»);
//   • чекбоксы с тегом #задача в любой другой заметке (уходят в список по умолчанию);
//   • строки, уже связанные с Google (%%gt:…%%), где бы они ни лежали.
//
// Связь строки и задачи — id задачи Google в комментарии %%gt:id%%.
// Для каждой пары хранится «база» — состояние на прошлой синхронизации. Сравнивая обе
// стороны с базой, видно, кто что поменял: изменения сливаются по полям
// (название, выполнено, срок). Если поле поменяли в обоих местах — побеждает Obsidian.
//
// Новые задачи из Google (невыполненные) дописываются в «Задачи/<Список>.md».
// Удалил задачу в одном месте — она удаляется и в другом, если её не правили с прошлого раза.
// Все правки заметок за один проход — один коммит.

import {
  formatTaskLine,
  fromGoogleDate,
  hasTag,
  listFileName,
  stripTag,
  taskLines,
  toGoogleDue,
} from "./tasks-md.mjs"
import { GoogleError } from "./google.mjs"

const SAME = (a, b) => a && b && a.title === b.title && a.done === b.done && a.due === b.due

function skipPath(p) {
  const segs = p.split("/")
  if (segs.some((s) => s.startsWith("."))) return true
  if (segs[0] === "templates" || segs[0] === "attachments") return true
  if (segs.length === 1 && /^(README|AGENTS|CLAUDE)\.md$/i.test(p)) return true
  return !/\.md$/i.test(p)
}

const gFields = (g) => ({
  title: (g.title ?? "").trim(),
  done: g.status === "completed",
  due: fromGoogleDate(g.due),
})

export class TaskSync {
  constructor({ cfg, github, google, tokens, store, now = () => Date.now(), log = console }) {
    this.cfg = cfg
    this.github = github
    this.google = google
    this.tokens = tokens
    this.store = store
    this.now = now
    this.log = log
    this.running = null
    this.blobCache = new Map()
  }

  /* ───── подключение Google ───── */

  get connected() {
    return Boolean(this.store.get("google")?.refresh)
  }

  status() {
    const g = this.store.get("google")
    const s = this.store.get("status", {})
    return {
      enabled: this.google.enabled,
      connected: this.connected,
      owner: g?.owner ?? null,
      running: Boolean(this.running),
      lastSync: s.lastSync ?? null,
      lastError: s.lastError ?? null,
      lastStats: s.lastStats ?? null,
      tasks: Object.keys(this.store.get("map", {})).length,
      intervalMin: this.cfg.gtasksIntervalMin,
    }
  }

  connect(owner, t) {
    this.store.set("google", {
      owner,
      refresh: t.refresh,
      access: t.access,
      accessExp: t.accessExp,
    })
    this.store.set("status", {})
  }

  disconnect() {
    this.store.set("google", null)
    this.store.set("map", null)
    this.store.set("status", {})
  }

  async googleAccess() {
    const g = this.store.get("google")
    if (!g?.refresh) throw new Error("Google Tasks не подключён")
    if (g.access && g.accessExp - 60_000 > this.now()) return g.access
    try {
      const t = await this.google.refresh(g.refresh)
      this.store.set("google", {
        ...g,
        access: t.access,
        accessExp: t.accessExp,
        refresh: t.refresh,
      })
      return t.access
    } catch (e) {
      if (e instanceof GoogleError && e.status === 401) {
        this.store.set("google", { ...g, refresh: null, access: null })
        throw new Error("Google отозвал доступ — подключите Google Tasks заново")
      }
      throw e
    }
  }

  /* ───── один проход ───── */

  /** Запускает синхронизацию; если она уже идёт — ждёт текущую. */
  run(reason = "timer") {
    if (!this.running) {
      this.running = this.syncOnce(reason)
        .then((stats) => {
          this.store.set("status", { lastSync: this.now(), lastError: null, lastStats: stats })
          return stats
        })
        .catch((e) => {
          const prev = this.store.get("status", {})
          this.store.set("status", { ...prev, lastError: e.message, lastErrorAt: this.now() })
          this.log.warn?.(`gtasks sync failed: ${e.message}`)
          throw e
        })
        .finally(() => {
          this.running = null
        })
    }
    return this.running
  }

  /* ───── доска задач для сайта: Google напрямую, порядок списков — у нас ───── */

  /** Синхронизация с заметками через несколько секунд после правок с сайта. */
  soon(delayMs = 4000) {
    clearTimeout(this.soonTimer)
    this.soonTimer = setTimeout(() => this.run("site").catch(() => {}), delayMs)
    this.soonTimer.unref?.()
  }

  prefs() {
    const p = this.store.get("prefs", {})
    return {
      order: Array.isArray(p.order) ? p.order : [],
      collapsed: Array.isArray(p.collapsed) ? p.collapsed : [],
      hidden: Array.isArray(p.hidden) ? p.hidden : [],
    }
  }

  setPrefs(p) {
    const clean = (a) =>
      Array.isArray(a)
        ? [...new Set(a.filter((x) => typeof x === "string" && x.length < 200))].slice(0, 200)
        : []
    const next = { order: clean(p.order), collapsed: clean(p.collapsed), hidden: clean(p.hidden) }
    this.store.set("prefs", next)
    return next
  }

  async board() {
    const access = await this.googleAccess()
    const lists = await this.google.lists(access)
    const map = this.store.get("map", {})
    const out = []
    for (const l of lists) {
      const tasks = (await this.google.tasks(access, l.id))
        .filter((t) => !t.deleted && (t.title ?? "").trim())
        .sort((a, b) => String(a.position ?? "").localeCompare(String(b.position ?? "")))
        .map((t) => ({
          id: t.id,
          title: (t.title ?? "").trim(),
          notes: t.notes ?? "",
          due: fromGoogleDate(t.due),
          done: t.status === "completed",
          completed: t.completed ?? null,
          parent: t.parent ?? null,
          note:
            map[t.id]?.path && !map[t.id].path.startsWith(this.cfg.gtasksFolder + "/")
              ? map[t.id].path
              : null,
        }))
      out.push({ id: l.id, title: l.title, tasks })
    }
    // порядок списков: сохранённый, новые — в конец
    const prefs = this.prefs()
    const rank = new Map(prefs.order.map((id, i) => [id, i]))
    out.sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6))
    return { lists: out, prefs }
  }

  async createTask({ listId, title, due, notes, parent, previous }) {
    const access = await this.googleAccess()
    const q = new URLSearchParams()
    if (parent) q.set("parent", parent)
    if (previous) q.set("previous", previous)
    const t = await this.google.createTask(
      access,
      listId,
      {
        title: String(title).trim().slice(0, 1000),
        ...(due ? { due: toGoogleDue(due) } : {}),
        ...(notes ? { notes: String(notes).slice(0, 8000) } : {}),
      },
      q.toString(),
    )
    this.soon()
    return t
  }

  async updateTask({ listId, id, title, notes, due, done }) {
    const access = await this.googleAccess()
    const patch = {}
    if (title !== undefined) patch.title = String(title).trim().slice(0, 1000)
    if (notes !== undefined) patch.notes = String(notes).slice(0, 8000)
    if (due !== undefined) patch.due = due ? toGoogleDue(due) : null
    if (done !== undefined) {
      patch.status = done ? "completed" : "needsAction"
      if (!done) patch.completed = null
    }
    const t = await this.google.patchTask(access, listId, id, patch)
    this.soon()
    return t
  }

  async removeTask({ listId, id }) {
    const access = await this.googleAccess()
    await this.google.deleteTask(access, listId, id)
    this.soon()
  }

  /** Перестановка: previous — задача, после которой встать (null — первой); можно в другой список. */
  async moveTask({ listId, id, previous, toListId }) {
    const access = await this.googleAccess()
    const t = await this.google.moveTask(access, listId, id, {
      previous: previous || null,
      destinationTasklist: toListId && toListId !== listId ? toListId : null,
    })
    this.soon()
    return t
  }

  async readFile(token, entry) {
    const hit = this.blobCache.get(entry.sha)
    if (hit !== undefined) return hit
    const text = await this.github.blob(token, entry.sha)
    if (this.blobCache.size > 2000) this.blobCache.clear()
    this.blobCache.set(entry.sha, text)
    return text
  }

  async syncOnce() {
    const owner = this.store.get("google")?.owner
    if (!owner) throw new Error("Google Tasks не подключён")
    const access = await this.googleAccess()
    const ghToken = await this.tokens.get(owner)
    const folder = this.cfg.gtasksFolder
    const tag = this.cfg.gtasksTag
    const today = new Date(this.now()).toISOString().slice(0, 10)
    const stats = { created: 0, updated: 0, imported: 0, deleted: 0, pulled: 0 }

    /* Obsidian: снимок ветки */
    const head = await this.github.headSha(ghToken)
    const tree = await this.github.treeAt(ghToken, head)
    const files = new Map() // path -> { lines: string[], changed }
    const entries = tree.filter((e) => e.type === "blob" && !skipPath(e.path))
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(
        entries.slice(i, i + 8).map(async (e) => {
          const text = await this.readFile(ghToken, e)
          files.set(e.path, { lines: text.split("\n"), changed: false, created: false })
        }),
      )
    }

    /* Google: все списки и задачи */
    const lists = await this.google.lists(access)
    const gTasks = new Map() // id -> { task, listId }
    for (const l of lists) {
      for (const t of await this.google.tasks(access, l.id)) {
        if (t.deleted) continue
        gTasks.set(t.id, { task: t, listId: l.id })
      }
    }
    const listByTitle = new Map(lists.map((l) => [l.title.toLowerCase(), l]))
    const defaultList =
      (this.cfg.gtasksDefaultList && listByTitle.get(this.cfg.gtasksDefaultList.toLowerCase())) ||
      lists[0] ||
      (await this.google.createList(access, this.cfg.gtasksDefaultList || "Задачи"))
    if (!lists.includes(defaultList)) lists.push(defaultList)

    const listFor = async (path) => {
      if (!path.startsWith(folder + "/")) return defaultList
      const name = path.split("/").pop().replace(/\.md$/i, "")
      let l = listByTitle.get(name.toLowerCase())
      if (!l) {
        l = await this.google.createList(access, name)
        lists.push(l)
        listByTitle.set(name.toLowerCase(), l)
      }
      return l
    }
    const fileForList = (listId) => {
      const l = lists.find((x) => x.id === listId)
      return `${folder}/${listFileName(l?.title)}.md`
    }

    const map = this.store.get("map", {}) // id -> { listId, base }
    const next = {}
    const seen = new Set()
    const created = [] // для отката, если коммит не прошёл
    const setLine = (path, i, value) => {
      const f = files.get(path)
      if (f.lines[i] !== value) {
        f.lines[i] = value
        f.changed = true
      }
    }

    const appendLine = (path, line) => {
      if (!files.has(path)) {
        files.set(path, {
          lines: ["---", "tags: [задачи]", "---", ""],
          changed: true,
          created: true,
        })
      }
      const f = files.get(path)
      while (f.lines.length && f.lines[f.lines.length - 1] === "") f.lines.pop()
      if (f.lines[f.lines.length - 1] === "---") f.lines.push("") // пустая строка после шапки
      f.lines.push(line, "")
      f.changed = true
    }
    const listIdOfFile = (path) => {
      const name = path.split("/").pop().replace(/\.md$/i, "")
      return listByTitle.get(name.toLowerCase())?.id ?? null
    }

    const createInGoogle = async (path, obs) => {
      const list = await listFor(path)
      const noteTitle = path.split("/").pop().replace(/\.md$/i, "")
      const task = await this.google.createTask(access, list.id, {
        title: obs.title,
        status: obs.done ? "completed" : "needsAction",
        ...(obs.due ? { due: toGoogleDue(obs.due) } : {}),
        ...(path.startsWith(folder + "/") ? {} : { notes: `Из заметки «${noteTitle}» в Obsidian` }),
      })
      created.push({ listId: list.id, id: task.id })
      stats.created++
      return { task, listId: list.id }
    }

    /* 1. Проход по заметкам */
    // снимок до правок: строки, перенесённые в другую заметку по ходу прохода, не читаем второй раз
    const snapshot = [...files].map(([path, f]) => [path, f.lines.join("\n")])
    for (const [path, content] of snapshot) {
      const inFolder = path.startsWith(folder + "/")
      if (inFolder && /\/index\.md$/i.test(path)) continue
      if (path === this.cfg.inboxPath) continue
      for (const t of taskLines(content)) {
        const linked = t.id && (map[t.id] || gTasks.has(t.id))
        if (!inFolder && !hasTag(t.text, tag) && !linked) continue
        const tagged = hasTag(t.text, tag)
        const obs = { title: stripTag(t.text, tag), done: t.done, due: t.due }
        if (!obs.title) continue
        const write = (fields, id, completedIso) =>
          setLine(
            path,
            t.line,
            formatTaskLine({
              indent: t.indent,
              done: fields.done,
              text: fields.title + (tagged && !inFolder ? ` ${tag}` : ""),
              due: fields.due,
              doneDate: fields.done ? (t.doneDate ?? fromGoogleDate(completedIso) ?? today) : null,
              id,
            }),
          )

        if (linked && !seen.has(t.id)) {
          seen.add(t.id)
          const base = map[t.id]?.base ?? null
          const g = gTasks.get(t.id)
          if (g) {
            const gf = gFields(g.task)
            const pick = (k) => (base && obs[k] === base[k] ? gf[k] : obs[k])
            const merged = { title: pick("title"), done: pick("done"), due: pick("due") }
            if (!SAME(merged, gf)) {
              await this.google.patchTask(access, g.listId, t.id, {
                title: merged.title,
                status: merged.done ? "completed" : "needsAction",
                due: merged.due ? toGoogleDue(merged.due) : null,
                ...(merged.done ? {} : { completed: null }),
              })
              stats.updated++
            }
            const moved = inFolder && listIdOfFile(path) !== g.listId
            if (moved) {
              // задачу перенесли в другой список — переносим строку в его заметку
              setLine(path, t.line, null)
              appendLine(
                fileForList(g.listId),
                formatTaskLine({
                  done: merged.done,
                  text: merged.title,
                  due: merged.due,
                  doneDate: merged.done
                    ? (t.doneDate ?? fromGoogleDate(g.task.completed) ?? today)
                    : null,
                  id: t.id,
                }),
              )
              stats.pulled++
            } else if (!SAME(merged, obs)) {
              write(merged, t.id, g.task.completed)
              stats.pulled++
            }
            next[t.id] = {
              listId: g.listId,
              base: merged,
              path: moved ? fileForList(g.listId) : path,
            }
          } else if (base && SAME(obs, base)) {
            // удалили в Google — удаляем строку
            setLine(path, t.line, null)
            stats.deleted++
          } else {
            // в Google нет, а строку меняли — создаём заново
            const c = await createInGoogle(path, obs)
            write(obs, c.task.id)
            next[c.task.id] = { listId: c.listId, base: obs, path }
          }
        } else {
          // новая задача (или копия уже связанной строки)
          const c = await createInGoogle(path, obs)
          write(obs, c.task.id)
          next[c.task.id] = { listId: c.listId, base: obs, path }
        }
      }
    }

    /* 2. Связанные задачи, строки которых исчезли из заметок */
    const toImport = []
    for (const [id, m] of Object.entries(map)) {
      if (seen.has(id) || next[id]) continue
      const g = gTasks.get(id)
      if (!g) continue // удалены с обеих сторон
      if (m.base && SAME(gFields(g.task), m.base)) {
        await this.google.deleteTask(access, g.listId, id)
        stats.deleted++
      } else toImport.push(g) // в Google правили — вернём строку
    }

    /* 3. Новые задачи из Google */
    for (const [id, g] of gTasks) {
      if (seen.has(id) || next[id] || map[id]) continue
      if (g.task.status === "completed" || !(g.task.title ?? "").trim()) continue
      toImport.push(g)
    }
    for (const g of toImport) {
      const path = fileForList(g.listId)
      const gf = gFields(g.task)
      appendLine(
        path,
        formatTaskLine({
          done: gf.done,
          text: gf.title,
          due: gf.due,
          doneDate: gf.done ? fromGoogleDate(g.task.completed) : null,
          id: g.task.id,
        }),
      )
      next[g.task.id] = { listId: g.listId, base: gf, path }
      stats.imported++
    }

    /* 4. Один коммит со всеми правками заметок */
    const changes = [...files]
      .filter(([, f]) => f.changed)
      .map(([path, f]) => ({ path, content: f.lines.filter((l) => l !== null).join("\n") }))
    if (changes.length) {
      try {
        await this.github.commitChanges(
          ghToken,
          head,
          changes,
          `Задачи: синхронизация с Google Tasks (${describe(stats)})`,
        )
      } catch (e) {
        // заметки не записались — убираем только что созданные в Google задачи,
        // иначе на следующем проходе они создадутся повторно
        for (const c of created)
          await this.google.deleteTask(access, c.listId, c.id).catch(() => {})
        throw new Error(
          e.status === 422
            ? "Заметки изменились во время синхронизации — повторю в следующий раз"
            : `Не удалось записать заметки: ${e.message}`,
        )
      }
    }
    this.store.set("map", next)
    return stats
  }
}

function describe(s) {
  const parts = []
  if (s.created) parts.push(`+${s.created} в Google`)
  if (s.imported) parts.push(`+${s.imported} из Google`)
  if (s.pulled) parts.push(`${s.pulled} обновлено`)
  if (s.updated) parts.push(`${s.updated} отправлено`)
  if (s.deleted) parts.push(`${s.deleted} удалено`)
  return parts.join(", ") || "без изменений"
}
