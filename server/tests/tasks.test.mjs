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
import { formatTaskLine, parseTaskLine, stripTag, taskLines } from "../src/tasks-md.mjs"

const ORIGIN = "https://kb.test"
const silent = { info() {}, warn() {}, error() {} }
let gh, g, server, base, sync, githubClient

/* ───── разбор строк ───── */

test("разбор и сборка строк задач", () => {
  const t = parseTaskLine("  - [x] Сдать отчёт #задача 📅 2026-11-10 ✅ 2026-11-07 %%gt:abc-1%%")
  assert.deepEqual(t, {
    indent: "  ",
    done: true,
    text: "Сдать отчёт #задача",
    due: "2026-11-10",
    doneDate: "2026-11-07",
    id: "abc-1",
  })
  assert.equal(stripTag(t.text, "#задача"), "Сдать отчёт")
  assert.equal(stripTag("#задача в начале", "#задача"), "в начале")
  assert.equal(stripTag("#задачами не тег", "#задача"), "#задачами не тег")
  assert.equal(
    formatTaskLine(t),
    "  - [x] Сдать отчёт #задача 📅 2026-11-10 ✅ 2026-11-07 %%gt:abc-1%%",
  )
  assert.equal(parseTaskLine("- обычный пункт"), null)
  const lines = taskLines(
    "---\nx: - [ ] не задача\n---\n- [ ] да\n```\n- [ ] код\n```\n* [ ] тоже\n",
  )
  assert.deepEqual(
    lines.map((l) => l.text),
    ["да", "тоже"],
  )
})

/* ───── синхронизация целиком ───── */

before(async () => {
  gh = await startMockGitHub({
    files: {
      "Задачи/Входящие.md":
        "---\ntags: [задачи]\n---\n\n- [ ] Купить молоко 📅 2026-11-10\n- [x] Старое дело\n",
      "Java/План.md":
        "# План\n\n- [ ] Повторить JVM #задача\n- [ ] Просто чекбокс в конспекте\n\n```\n- [ ] в коде #задача\n```\n",
      "templates/Заметка.md": "- [ ] шаблон #задача\n",
    },
  })
  g = await startMockGoogle({ lists: [{ title: "Мои задачи" }] })
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
  githubClient = new GitHub(cfg)
  const tokens = new TokenKeeper({
    store: new SecretStore(null, null),
    github: githubClient,
    log: silent,
  })
  const google = new Google(cfg)
  sync = new TaskSync({
    cfg,
    github: githubClient,
    google,
    tokens,
    store: new SecretStore(null, null),
    log: silent,
  })
  const sessions = new SessionStore({ file: null, key: deriveKey("z".repeat(40), "s"), ttlMs: 1e9 })
  const app = createApp(cfg, {
    github: githubClient,
    sessions,
    tokens,
    google,
    tasks: sync,
    log: silent,
  })
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.closeAllConnections()
  server.close()
  await gh.close()
  await g.close()
})

function client() {
  const jar = new Map()
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";")
      const [k, v] = pair.split("=")
      if (attrs.some((a) => a.trim() === "Max-Age=0")) jar.delete(k.trim())
      else jar.set(k.trim(), v)
    }
  }
  const req = async (method, url, { csrf = true } = {}) => {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }
    if (method !== "GET" && csrf) Object.assign(headers, { origin: ORIGIN, "x-kb-request": "1" })
    const res = await fetch(url.startsWith("http") ? url : base + url, {
      method,
      headers,
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
  /** Переход по цепочке редиректов (внешние — без наших cookie). */
  const follow = async (r) => {
    while (r.status === 302) {
      const loc = r.headers.get("location")
      if (loc.startsWith("/?")) return { status: 302, location: loc } // страница сайта
      if (loc.startsWith("/")) r = await req("GET", loc)
      else {
        const u = new URL(loc)
        if (u.origin === base || u.origin === ORIGIN) r = await req("GET", u.pathname + u.search)
        else {
          const ext = await fetch(loc, { redirect: "manual" })
          r = { status: ext.status, headers: ext.headers }
        }
      }
    }
    return r
  }
  return { jar, req, follow }
}

const file = (p) => gh.state.files.get(p)?.toString("utf8")
const gtask = (title) => g.all().find((t) => t.title === title)

test("закрытый сайт: auth/check без входа 401, после входа 204", async () => {
  const c = client()
  assert.equal((await c.req("GET", "/api/auth/check")).status, 401)
  await c.follow(await c.req("GET", "/api/auth/login?next=/"))
  assert.equal((await c.req("GET", "/api/auth/check")).status, 204)
  const me = await c.req("GET", "/api/me")
  assert.equal(me.data.gtasks, true)
})

test("подключение Google и первая синхронизация", async () => {
  const c = client()
  // без входа подключить нельзя
  assert.equal((await c.req("GET", "/api/gtasks/connect")).status, 401)
  await c.follow(await c.req("GET", "/api/auth/login?next=/"))
  const r = await c.follow(await c.req("GET", "/api/gtasks/connect"))
  assert.equal(r.location, "/?kb-gtasks=ok")
  await sync.running // первая синхронизация запускается сразу после подключения
  const st = await c.req("GET", "/api/gtasks/status")
  assert.equal(st.data.connected, true)
  assert.equal(st.data.lastError, null, st.data.lastError)

  // папка «Задачи»: заметка «Входящие» → список «Входящие»
  assert.ok(g.list("Входящие"))
  const milk = gtask("Купить молоко")
  assert.equal(milk.list, "Входящие")
  assert.equal(milk.due.slice(0, 10), "2026-11-10")
  assert.equal(gtask("Старое дело").status, "completed")
  // тег #задача вне папки → список по умолчанию, без тега в названии
  const jvm = gtask("Повторить JVM")
  assert.equal(jvm.list, "Мои задачи")
  assert.match(jvm.notes, /План/)
  // лишнее не уехало
  assert.equal(g.all().length, 3)
  // в заметки записались связи
  assert.match(
    file("Задачи/Входящие.md"),
    new RegExp(`Купить молоко 📅 2026-11-10 %%gt:${milk.id}%%`),
  )
  assert.match(file("Java/План.md"), new RegExp(`Повторить JVM #задача %%gt:${jvm.id}%%`))
  assert.match(file("Java/План.md"), /- \[ \] Просто чекбокс в конспекте\n/)
  assert.match(file("Java/План.md"), /- \[ \] в коде #задача\n/)
  assert.equal(file("templates/Заметка.md"), "- [ ] шаблон #задача\n")
  assert.match(gh.state.log.at(-1), /Задачи: синхронизация с Google Tasks/)
})

test("повторный проход без изменений не делает коммит", async () => {
  const n = gh.state.log.length
  const stats = await sync.run("test")
  assert.deepEqual(stats, { created: 0, updated: 0, imported: 0, deleted: 0, pulled: 0 })
  assert.equal(gh.state.log.length, n)
})

test("изменения в Google приходят в заметки", async () => {
  g.edit(gtask("Купить молоко").id, { status: "completed" })
  g.add("Мои задачи", { title: "Позвонить маме", due: "2026-11-12T15:00:00.000Z" })
  g.add("Мои задачи", { title: "Давно сделано", status: "completed" })
  await sync.run("test")
  assert.match(
    file("Задачи/Входящие.md"),
    /- \[x\] Купить молоко 📅 2026-11-10 ✅ \d{4}-\d{2}-\d{2} %%gt:/,
  )
  const inbox = file("Задачи/Мои задачи.md")
  assert.ok(inbox.startsWith("---\ntags: [задачи]\n---\n"))
  assert.match(inbox, /- \[ \] Позвонить маме 📅 2026-11-12 %%gt:/)
  assert.ok(!inbox.includes("Давно сделано"), "старые выполненные не тянем")
})

test("изменения в Obsidian уходят в Google", async () => {
  const plan = file("Java/План.md").replace(
    /- \[ \] Повторить JVM #задача/,
    "- [ ] Повторить JVM и GC #задача 📅 2026-12-01",
  )
  gh.externalEdit("Java/План.md", plan)
  const inbox = file("Задачи/Входящие.md") + "- [ ] Новая из Obsidian\n"
  gh.externalEdit("Задачи/Входящие.md", inbox)
  await sync.run("test")
  const jvm = gtask("Повторить JVM и GC")
  assert.ok(jvm)
  assert.equal(jvm.due.slice(0, 10), "2026-12-01")
  assert.equal(gtask("Новая из Obsidian").list, "Входящие")
  assert.match(file("Задачи/Входящие.md"), /Новая из Obsidian %%gt:/)
})

test("правка в обоих местах: по полям, при споре побеждает Obsidian", async () => {
  const jvm = gtask("Повторить JVM и GC")
  g.edit(jvm.id, { status: "completed", title: "Название из Google" })
  gh.externalEdit(
    "Java/План.md",
    file("Java/План.md").replace("Повторить JVM и GC", "Название из Obsidian"),
  )
  await sync.run("test")
  const t = g.all().find((x) => x.id === jvm.id)
  assert.equal(t.title, "Название из Obsidian")
  assert.equal(t.status, "completed")
  assert.match(file("Java/План.md"), /- \[x\] Название из Obsidian #задача 📅 2026-12-01 ✅/)
})

test("удаление в одном месте удаляет и в другом", async () => {
  // удалили строку в Obsidian
  const call = gtask("Позвонить маме")
  gh.externalEdit(
    "Задачи/Мои задачи.md",
    file("Задачи/Мои задачи.md")
      .split("\n")
      .filter((l) => !l.includes("Позвонить маме"))
      .join("\n"),
  )
  // удалили задачу в Google
  g.remove(gtask("Старое дело").id)
  await sync.run("test")
  assert.equal(
    g.all().find((x) => x.id === call.id),
    undefined,
  )
  assert.ok(!file("Задачи/Входящие.md").includes("Старое дело"))
})

test("если заметки изменились во время прохода — созданное в Google откатывается", async () => {
  gh.externalEdit("Задачи/Входящие.md", file("Задачи/Входящие.md") + "- [ ] Гонка\n")
  const orig = githubClient.commitChanges
  githubClient.commitChanges = async () => {
    const e = new Error("Update is not a fast forward")
    e.status = 422
    throw e
  }
  await assert.rejects(sync.run("test"), /изменились во время синхронизации/)
  githubClient.commitChanges = orig
  assert.equal(gtask("Гонка"), undefined)
  assert.match(sync.status().lastError, /изменились/)
  await sync.run("test")
  assert.ok(gtask("Гонка"))
  assert.equal(g.all().filter((x) => x.title === "Гонка").length, 1)
  assert.equal(sync.status().lastError, null)
})

test("отключение Google", async () => {
  const c = client()
  await c.follow(await c.req("GET", "/api/auth/login?next=/"))
  assert.equal((await c.req("POST", "/api/gtasks/disconnect")).status, 200)
  assert.equal((await c.req("GET", "/api/gtasks/status")).data.connected, false)
  assert.equal((await c.req("POST", "/api/gtasks/sync")).status, 409)
})
