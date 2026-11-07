import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { startMockGitHub } from "./mock-github.mjs"
import { startMockGoogle } from "./mock-google.mjs"
import { createApp } from "../src/app.mjs"
import { GitHub } from "../src/github.mjs"
import { Google } from "../src/google.mjs"
import { SessionStore } from "../src/sessions.mjs"
import { SecretStore } from "../src/store.mjs"
import { TokenKeeper } from "../src/tokens.mjs"
import { TaskSync } from "../src/tasksync.mjs"
import { deriveKey } from "../src/crypto.mjs"
import { loadConfig } from "../src/config.mjs"
import { addItem, parseInbox, publicItems, removeItem, updateItem } from "../src/inbox-md.mjs"

const ORIGIN = "https://kb.test"
const silent = { info() {}, warn() {}, error() {} }
let gh, g, server, base, sync, c

/* ───── Inbox.md ───── */

test("Inbox.md: разбор, добавление сверху, правка и удаление", () => {
  const src =
    "# Inbox\n\nМои мысли.\n\n- 2026-11-06 22:05 Старая мысль\n  вторая строка\n- без даты, из Obsidian\n\nхвост\n"
  const items = publicItems(src)
  assert.deepEqual(
    items.map((i) => [i.date, i.time, i.text]),
    [
      ["2026-11-06", "22:05", "Старая мысль\nвторая строка"],
      [null, null, "без даты, из Obsidian"],
    ],
  )
  const added = addItem(src, { date: "2026-11-07", time: "09:12", text: "Новая\nв две строки" })
  assert.equal(
    added,
    "# Inbox\n\nМои мысли.\n\n- 2026-11-07 09:12 Новая\n  в две строки\n- 2026-11-06 22:05 Старая мысль\n  вторая строка\n- без даты, из Obsidian\n\nхвост\n",
  )
  const first = publicItems(added)[1]
  const edited = updateItem(added, first.id, "Старая мысль, дописал")
  assert.match(edited, /- 2026-11-06 22:05 Старая мысль, дописал\n- без даты/)
  const removed = removeItem(edited, publicItems(edited)[0].id)
  assert.ok(!removed.includes("Новая"))
  assert.ok(removed.includes("хвост"))
  assert.equal(updateItem(src, "нет-такого", "x"), null)
  assert.equal(
    addItem("", { date: "2026-11-07", time: null, text: "Первая" }),
    "# Inbox\n\n- 2026-11-07 Первая\n",
  )
  assert.equal(parseInbox("# Inbox\n").items.length, 0)
})

/* ───── API ───── */

before(async () => {
  gh = await startMockGitHub({
    files: { "Inbox.md": "# Inbox\n\n- 2026-11-06 22:05 Почитать про виртуальные потоки\n" },
  })
  g = await startMockGoogle({ lists: [{ title: "Мои задачи" }, { title: "Работа" }] })
  g.add("Мои задачи", { title: "Первая" })
  g.add("Мои задачи", { title: "Вторая", due: "2026-11-10T00:00:00.000Z" })
  g.add("Работа", { title: "Ревью" })
  const cfg = loadConfig({
    GITHUB_CLIENT_ID: "Iv1.test",
    GITHUB_CLIENT_SECRET: "secret",
    SITE_ORIGIN: ORIGIN,
    ALLOWED_USERS: "vlmb",
    SESSION_SECRET: "y".repeat(40),
    GITHUB_API: gh.url,
    GITHUB_WEB: gh.url,
    COOKIE_SECURE: "false",
    GOOGLE_CLIENT_ID: "g-id",
    GOOGLE_CLIENT_SECRET: "g-secret",
    GOOGLE_AUTH_URL: `${g.url}/auth`,
    GOOGLE_TOKEN_URL: `${g.url}/token`,
    GOOGLE_API: g.url,
  })
  const github = new GitHub(cfg)
  const tokens = new TokenKeeper({ store: new SecretStore(null, null), github, log: silent })
  const google = new Google(cfg)
  sync = new TaskSync({
    cfg,
    github,
    google,
    tokens,
    store: new SecretStore(null, null),
    log: silent,
  })
  const sessions = new SessionStore({ file: null, key: deriveKey("z".repeat(40), "s"), ttlMs: 1e9 })
  server = http.createServer(
    createApp(cfg, { github, sessions, tokens, google, tasks: sync, log: silent }),
  )
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${server.address().port}`
  c = client()
  await c.follow(await c.req("GET", "/api/auth/login?next=/"))
})

after(async () => {
  clearTimeout(sync.soonTimer)
  server.closeAllConnections()
  server.close()
  await gh.close()
  await g.close()
})

function client() {
  const jar = new Map()
  const keep = (res) => {
    for (const ck of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = ck.split(";")
      const [k, v] = pair.split("=")
      if (attrs.some((a) => a.trim() === "Max-Age=0")) jar.delete(k.trim())
      else jar.set(k.trim(), v)
    }
  }
  const req = async (method, url, json) => {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }
    if (method !== "GET") Object.assign(headers, { origin: ORIGIN, "x-kb-request": "1" })
    if (json !== undefined) headers["content-type"] = "application/json"
    const res = await fetch(url.startsWith("http") ? url : base + url, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: "manual",
    })
    keep(res)
    const text = await res.text()
    let data = text
    try {
      data = JSON.parse(text)
    } catch {}
    return { status: res.status, data, headers: res.headers }
  }
  const follow = async (r) => {
    while (r.status === 302) {
      const loc = r.headers.get("location")
      if (loc.startsWith("/?")) return { status: 302, location: loc }
      const u = new URL(loc, base)
      if (u.origin === base || u.origin === ORIGIN) r = await req("GET", u.pathname + u.search)
      else {
        const ext = await fetch(loc, { redirect: "manual" })
        r = { status: ext.status, headers: ext.headers }
      }
    }
    return r
  }
  return { req, follow }
}

const inbox = () => gh.state.files.get("Inbox.md").toString("utf8")

test("Inbox через API: список, добавить, дописать, удалить", async () => {
  const r0 = await c.req("GET", "/api/inbox")
  assert.equal(r0.status, 200)
  assert.equal(r0.data.items.length, 1)
  const add = await c.req("POST", "/api/inbox", { text: "Пет-проект: бот", at: "2026-11-07 09:12" })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  assert.equal(add.data.items[0].text, "Пет-проект: бот")
  assert.match(inbox(), /^# Inbox\n\n- 2026-11-07 09:12 Пет-проект: бот\n- 2026-11-06 22:05/)
  assert.match(gh.state.log.at(-1), /Inbox: новая мысль/)

  // правка в Obsidian между чтением и записью не мешает: id считается по актуальному файлу
  gh.externalEdit("Inbox.md", inbox() + "- дописал в Obsidian\n")
  const id = add.data.items[0].id
  const upd = await c.req("PUT", "/api/inbox", {
    id,
    text: "Пет-проект: бот с вопросами\nи проверкой ответа",
  })
  assert.equal(upd.status, 200, JSON.stringify(upd.data))
  assert.match(inbox(), /- 2026-11-07 09:12 Пет-проект: бот с вопросами\n  и проверкой ответа\n/)
  assert.match(inbox(), /- дописал в Obsidian/)

  const del = await c.req("DELETE", "/api/inbox", { id: upd.data.items[0].id })
  assert.equal(del.status, 200)
  assert.ok(!inbox().includes("Пет-проект"))
  // удалённую ещё раз — 409
  assert.equal((await c.req("DELETE", "/api/inbox", { id })).status, 409)
  assert.equal((await c.req("POST", "/api/inbox", { text: "   " })).status, 400)
})

test("доска задач: без Google — 409, после подключения — списки и задачи", async () => {
  assert.equal((await c.req("GET", "/api/gtasks/board")).status, 409)
  const r = await c.follow(await c.req("GET", "/api/gtasks/connect"))
  assert.equal(r.location, "/?kb-gtasks=ok")
  await sync.running
  const b = await c.req("GET", "/api/gtasks/board")
  assert.equal(b.status, 200, JSON.stringify(b.data))
  assert.deepEqual(
    b.data.lists.map((l) => [l.title, l.tasks.map((t) => t.title)]),
    [
      ["Мои задачи", ["Первая", "Вторая"]],
      ["Работа", ["Ревью"]],
    ],
  )
  assert.equal(b.data.lists[0].tasks[1].due, "2026-11-10")
})

test("доска: создать, отметить, изменить срок, удалить", async () => {
  const b = (await c.req("GET", "/api/gtasks/board")).data
  const my = b.lists[0]
  const add = await c.req("POST", "/api/gtasks/task", {
    listId: my.id,
    title: "С сайта",
    due: "2026-11-12",
  })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const id = add.data.id
  assert.equal(
    (await c.req("PATCH", "/api/gtasks/task", { listId: my.id, id, done: true })).data.status,
    "completed",
  )
  const und = await c.req("PATCH", "/api/gtasks/task", {
    listId: my.id,
    id,
    done: false,
    due: null,
    title: "С сайта!",
  })
  assert.equal(und.data.status, "needsAction")
  assert.equal(und.data.due, undefined)
  assert.equal(und.data.title, "С сайта!")
  assert.equal(
    (await c.req("PATCH", "/api/gtasks/task", { listId: my.id, id, due: "11.12" })).status,
    400,
  )
  assert.equal((await c.req("DELETE", "/api/gtasks/task", { listId: my.id, id })).status, 200)
  assert.equal(
    g.all().find((t) => t.id === id),
    undefined,
  )
})

test("доска: перетаскивание внутри списка и в другой список, порядок списков", async () => {
  let b = (await c.req("GET", "/api/gtasks/board")).data
  const [my, work] = b.lists
  const [first, second] = my.tasks
  // «Вторая» — наверх
  await c.req("POST", "/api/gtasks/move", { listId: my.id, id: second.id, previous: null })
  b = (await c.req("GET", "/api/gtasks/board")).data
  assert.deepEqual(
    b.lists[0].tasks.map((t) => t.title),
    ["Вторая", "Первая"],
  )
  // «Первая» — в «Работу» после «Ревью»
  await c.req("POST", "/api/gtasks/move", {
    listId: my.id,
    id: first.id,
    previous: work.tasks[0].id,
    toListId: work.id,
  })
  b = (await c.req("GET", "/api/gtasks/board")).data
  assert.deepEqual(
    b.lists[1].tasks.map((t) => t.title),
    ["Ревью", "Первая"],
  )
  // порядок списков и скрытие — на сервере, одинаково на всех устройствах
  const p = await c.req("PUT", "/api/gtasks/prefs", {
    order: [work.id, my.id],
    hidden: [my.id],
    collapsed: [],
  })
  assert.equal(p.status, 200)
  b = (await c.req("GET", "/api/gtasks/board")).data
  assert.deepEqual(
    b.lists.map((l) => l.title),
    ["Работа", "Мои задачи"],
  )
  assert.deepEqual(b.prefs.hidden, [my.id])
})

test("перенос задачи в другой список переносит строку между заметками", async () => {
  await sync.run("test")
  const f = (p) => gh.state.files.get(p)?.toString("utf8") ?? ""
  assert.match(f("Задачи/Работа.md"), /Первая %%gt:/)
  assert.ok(!f("Задачи/Мои задачи.md").includes("Первая"))
  const b = (await c.req("GET", "/api/gtasks/board")).data
  const work = b.lists.find((l) => l.title === "Работа")
  const my = b.lists.find((l) => l.title === "Мои задачи")
  const t = work.tasks.find((x) => x.title === "Первая")
  await c.req("POST", "/api/gtasks/move", {
    listId: work.id,
    id: t.id,
    previous: null,
    toListId: my.id,
  })
  await sync.run("test")
  await sync.run("test")
  assert.match(f("Задачи/Мои задачи.md"), /Первая %%gt:/)
  const titles = g.all().map((t) => t.title)
  assert.equal(new Set(titles).size, titles.length, `дубли: ${titles}`)
  assert.ok(!f("Задачи/Работа.md").includes("Первая"))
  // Inbox.md и index.md в папке задач синхронизация не трогает
  gh.externalEdit("Задачи/index.md", "---\ntitle: Задачи\n---\n- [ ] не задача\n")
  gh.externalEdit("Inbox.md", f("Inbox.md") + "- [ ] чекбокс в инбоксе\n")
  const stats = await sync.run("test")
  assert.equal(stats.created, 0)
})
