import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { startMockGitHub } from "./mock-github.mjs"
import { createApp } from "../src/app.mjs"
import { GitHub } from "../src/github.mjs"
import { SessionStore } from "../src/sessions.mjs"
import { deriveKey } from "../src/crypto.mjs"
import { loadConfig } from "../src/config.mjs"

const ORIGIN = "https://kb.test"
let mock, server, base, clock, sessionsFile, cfg

const silent = { info() {}, warn() {}, error() {} }

before(async () => {
  mock = await startMockGitHub({
    files: {
      "Базы данных/Индексы.md": "---\ntags: [бд]\n---\n\nИндекс — это структура.\n",
      "templates/Заметка.md": "---\ntags: []\n---\n",
      ".github/workflows/deploy.yml": "name: deploy\n",
    },
  })
  clock = Date.now()
  sessionsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kb-api-")), "sessions.enc")
  cfg = loadConfig({
    GITHUB_CLIENT_ID: "Iv1.test",
    GITHUB_CLIENT_SECRET: "secret",
    SITE_ORIGIN: ORIGIN,
    REPO: "VLmb/knowledge",
    ALLOWED_USERS: "vlmb",
    SESSION_SECRET: "x".repeat(40),
    GITHUB_API: mock.url,
    GITHUB_WEB: mock.url,
    COOKIE_SECURE: "false",
    MAX_UPLOAD_MB: "1",
  })
  const sessions = new SessionStore({
    file: sessionsFile,
    key: deriveKey(cfg.sessionSecret, "sessions"),
    ttlMs: cfg.sessionTtlMs,
    now: () => clock,
  })
  const app = createApp(cfg, { github: new GitHub(cfg), sessions, now: () => clock, log: silent })
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${server.address().port}`
  globalThis.__sessions = sessions
})

after(async () => {
  // keep-alive соединения fetch иначе держат процесс открытым
  server.closeAllConnections()
  server.close()
  await mock.close()
})

/** Мини-клиент с cookie, как браузер. */
function client() {
  const jar = new Map()
  const store = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";")
      const [k, v] = pair.split("=")
      if (attrs.some((a) => a.trim() === "Max-Age=0")) jar.delete(k.trim())
      else jar.set(k.trim(), v)
    }
  }
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
  return {
    jar,
    async req(method, url, { json, body, headers = {}, csrf = true } = {}) {
      const h = { cookie: cookieHeader(), ...headers }
      if (method !== "GET" && csrf) Object.assign(h, { origin: ORIGIN, "x-kb-request": "1" })
      if (json !== undefined) h["content-type"] = "application/json"
      const res = await fetch(base + url, {
        method,
        headers: h,
        body: json !== undefined ? JSON.stringify(json) : body,
        redirect: "manual",
      })
      store(res)
      const text = await res.text()
      let data = text
      try {
        data = JSON.parse(text)
      } catch {}
      return { status: res.status, data, headers: res.headers }
    },
    async login(next = "/notes/x") {
      const r1 = await this.req("GET", `/api/auth/login?next=${encodeURIComponent(next)}`)
      assert.equal(r1.status, 302)
      const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" }) // GitHub
      const cb = new URL(r2.headers.get("location"))
      return this.req("GET", cb.pathname + cb.search)
    },
  }
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex")

test("health и запрет без входа", async () => {
  const c = client()
  assert.deepEqual((await c.req("GET", "/api/health")).data, { ok: true })
  assert.equal((await c.req("GET", "/api/me")).status, 401)
  assert.equal((await c.req("GET", "/api/nope")).status, 404)
})

test("вход через GitHub и возврат на страницу", async () => {
  const c = client()
  const r = await c.login("/базы-данных/индексы")
  assert.equal(r.status, 302)
  assert.equal(decodeURIComponent(r.headers.get("location")), "/базы-данных/индексы?kb-auth=ok")
  assert.ok(c.jar.has("kb_session"))
  assert.ok(!c.jar.has("kb_oauth"), "cookie состояния OAuth удалена")
  const me = await c.req("GET", "/api/me")
  assert.equal(me.status, 200)
  assert.equal(me.data.login, "VLmb")
})

test("чужой логин не пускаем, подмена state не проходит", async () => {
  mock.state.login = "Stranger"
  const c = client()
  const r = await c.login("/")
  mock.state.login = "VLmb"
  assert.match(r.headers.get("location"), /kb-auth=denied/)
  assert.equal((await c.req("GET", "/api/me")).status, 401)

  const c2 = client()
  await c2.req("GET", "/api/auth/login?next=/")
  const bad = await c2.req("GET", "/api/auth/callback?code=x&state=forged")
  assert.match(bad.headers.get("location"), /kb-auth=error/)
})

test("открытый редирект невозможен", async () => {
  const c = client()
  const r = await c.login("//evil.example/path")
  assert.equal(r.headers.get("location"), "/?kb-auth=ok")
})

test("CSRF: без заголовка или с чужим Origin — 403", async () => {
  const c = client()
  await c.login()
  const body = { path: "Базы данных/Индексы.md", content: "x", sha: "0" }
  assert.equal((await c.req("PUT", "/api/file", { json: body, csrf: false })).status, 403)
  const evil = await c.req("PUT", "/api/file", {
    json: body,
    csrf: false,
    headers: { origin: "https://evil.example", "x-kb-request": "1" },
  })
  assert.equal(evil.status, 403)
})

test("чтение, правка, конфликт с Obsidian", async () => {
  const c = client()
  await c.login()
  const p = "Базы данных/Индексы.md"
  const f = await c.req("GET", `/api/file?path=${encodeURIComponent(p)}`)
  assert.equal(f.status, 200)
  assert.match(f.data.content, /Индекс — это структура/)

  const saved = await c.req("PUT", "/api/file", {
    json: { path: p, content: f.data.content + "\nНовая строка\n", sha: f.data.sha },
  })
  assert.equal(saved.status, 200)
  assert.match(mock.state.files.get(p).toString(), /Новая строка/)
  assert.match(mock.state.log.at(-1), /Правка «Индексы» с сайта/)

  mock.externalEdit(p, "Правка из Obsidian\n")
  const conflict = await c.req("PUT", "/api/file", {
    json: { path: p, content: "моё", sha: saved.data.sha },
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.data.error, "conflict")
  assert.equal(conflict.data.current.content, "Правка из Obsidian\n")

  const force = await c.req("PUT", "/api/file", {
    json: { path: p, content: "моё", sha: conflict.data.current.sha },
  })
  assert.equal(force.status, 200)
})

test("новая заметка и защита от перезаписи", async () => {
  const c = client()
  await c.login()
  const p = "Сети/TCP.md"
  const r = await c.req("PUT", "/api/file", { json: { path: p, content: "# TCP\n" } })
  assert.equal(r.status, 200)
  assert.match(mock.state.log.at(-1), /Новая заметка «TCP»/)
  const again = await c.req("PUT", "/api/file", { json: { path: p, content: "x" } })
  assert.equal(again.status, 409)
  assert.equal(again.data.error, "exists")
})

test("запрещённые пути", async () => {
  const c = client()
  await c.login()
  for (const p of [
    "../etc/passwd.md",
    ".github/workflows/deploy.yml",
    ".obsidian/app.md",
    "a/../b.md",
    "Сети/x.txt",
    "a#b.md",
    "/",
  ]) {
    const r = await c.req("PUT", "/api/file", { json: { path: p, content: "x" } })
    assert.equal(r.status, 400, p)
  }
  assert.equal((await c.req("GET", "/api/file?path=.github%2Fworkflows%2Fdeploy.yml")).status, 400)
})

test("загрузка картинок", async () => {
  const c = client()
  await c.login()
  const up = (name, body, type = "image/png") =>
    c.req("POST", `/api/upload?name=${encodeURIComponent(name)}`, {
      body,
      headers: { "content-type": type },
    })
  const a = await up("Схема индекса.png", PNG)
  assert.equal(a.status, 200)
  assert.equal(a.data.name, "Схема-индекса.png")
  assert.ok(mock.state.files.has("attachments/Схема-индекса.png"))
  const b = await up("Схема индекса.png", PNG)
  assert.equal(b.data.name, "Схема-индекса-1.png")
  assert.equal((await up("fake.png", Buffer.from("not a png"))).status, 400)
  assert.equal((await up("x.exe", PNG)).status, 400)
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  assert.equal((await up("x.svg", svg, "image/svg+xml")).status, 400)
  assert.equal(
    (await up("big.png", Buffer.concat([PNG, Buffer.alloc(1.2 * 1024 * 1024)]))).status,
    413,
  )
})

test("перенос одним коммитом и удаление", async () => {
  const c = client()
  await c.login()
  await c.req("PUT", "/api/file", { json: { path: "Черновики/Идея.md", content: "идея\n" } })
  const commits = mock.state.log.length
  const mv = await c.req("POST", "/api/move", {
    json: { from: "Черновики/Идея.md", to: "Алгоритмы/Идея.md" },
  })
  assert.equal(mv.status, 200)
  assert.equal(mock.state.log.length, commits + 1)
  assert.ok(mock.state.files.has("Алгоритмы/Идея.md"))
  assert.ok(!mock.state.files.has("Черновики/Идея.md"))
  const taken = await c.req("POST", "/api/move", {
    json: { from: "Алгоритмы/Идея.md", to: "Базы данных/Индексы.md" },
  })
  assert.equal(taken.status, 409)

  const del = await c.req("DELETE", "/api/file", {
    json: { path: "Алгоритмы/Идея.md", sha: mv.data.sha },
  })
  assert.equal(del.status, 200)
  assert.ok(!mock.state.files.has("Алгоритмы/Идея.md"))
})

test("дерево и статус публикации", async () => {
  const c = client()
  await c.login()
  const t = await c.req("GET", "/api/tree")
  assert.ok(t.data.dirs.includes("Базы данных"))
  assert.ok(!t.data.dirs.some((d) => d.startsWith(".github")))
  assert.ok(t.data.notes.includes("Базы данных/Индексы.md"))
  const sha = mock.state.head
  assert.equal((await c.req("GET", `/api/deploy?sha=${sha}`)).data.status, "in_progress")
  clock += 5000
  const done = await c.req("GET", `/api/deploy?sha=${sha}`)
  assert.equal(done.data.status, "completed")
  assert.equal(done.data.conclusion, "success")
  assert.equal((await c.req("GET", "/api/deploy?sha=zzz")).status, 400)
})

test("токен GitHub обновляется сам, выход завершает сессию", async () => {
  const c = client()
  await c.login()
  clock += 9 * 3600 * 1000 // токен GitHub App живёт 8 часов
  const me = await c.req("GET", "/api/me")
  assert.equal(me.status, 200)
  const out = await c.req("POST", "/api/auth/logout")
  assert.equal(out.status, 200)
  assert.equal((await c.req("GET", "/api/me")).status, 401)
})

test("сессии на диске зашифрованы и переживают перезапуск", async () => {
  const c = client()
  await c.login()
  globalThis.__sessions.flush()
  const raw = fs.readFileSync(sessionsFile, "utf8")
  assert.ok(!raw.includes("ghu_"), "токен не лежит открытым текстом")
  assert.ok(!raw.includes("VLmb"))
  const reloaded = new SessionStore({
    file: sessionsFile,
    key: deriveKey(cfg.sessionSecret, "sessions"),
    ttlMs: cfg.sessionTtlMs,
    now: () => clock,
  })
  assert.ok(reloaded.get(decodeURIComponent(c.jar.get("kb_session"))))
})
