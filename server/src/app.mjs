import { BadRequest, checkFileContent, notePath, titleOf, uploadName } from "./paths.mjs"
import { deriveKey, open, randomId, safeEqual, seal } from "./crypto.mjs"
import { GitHubError } from "./github.mjs"
import { SecretStore } from "./store.mjs"
import { addItem, publicItems, removeItem, updateItem } from "./inbox-md.mjs"
import { TokenError, TokenKeeper } from "./tokens.mjs"

const JSON_LIMIT = 2 * 1024 * 1024
const STATE_TTL = 10 * 60 * 1000

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  })
  res.end(payload)
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers })
  res.end()
}

function parseCookies(header) {
  const out = {}
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function readBody(req, limit) {
  const tooBig = () =>
    new HttpError(413, `Слишком большой файл (максимум ${Math.round(limit / 1048576)} МБ)`)
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > limit) {
      req.resume() // дочитываем и выбрасываем, чтобы клиент получил ответ 413
      reject(tooBig())
      return
    }
    const chunks = []
    let size = 0
    let over = false
    req.on("data", (c) => {
      size += c.length
      if (size > limit) over = true
      else chunks.push(c)
    })
    req.on("end", () => (over ? reject(tooBig()) : resolve(Buffer.concat(chunks))))
    req.on("error", reject)
  })
}

async function readJson(req) {
  const buf = await readBody(req, JSON_LIMIT)
  try {
    return JSON.parse(buf.toString("utf8") || "{}")
  } catch {
    throw new BadRequest("Некорректный JSON")
  }
}

/** Безопасный адрес возврата после входа: только путь на этом же сайте. */
function safeNext(next) {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return "/"
  }
  return next.slice(0, 500)
}

class RateLimiter {
  constructor(limit, windowMs, now) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
    this.hits = new Map()
  }
  check(key) {
    const t = this.now()
    const e = this.hits.get(key)
    if (!e || t - e.start > this.windowMs) {
      this.hits.set(key, { start: t, n: 1 })
      if (this.hits.size > 5000) this.hits.clear()
      return true
    }
    e.n++
    return e.n <= this.limit
  }
}

export function createApp(
  cfg,
  { github, sessions, tokens, google = null, tasks = null, now = () => Date.now(), log = console },
) {
  tokens ??= new TokenKeeper({ store: new SecretStore(null, null), github, now, log })
  const cookieName = cfg.secureCookies ? "__Host-kb_session" : "kb_session"
  const stateCookie = cfg.secureCookies ? "__Host-kb_oauth" : "kb_oauth"
  const gStateCookie = cfg.secureCookies ? "__Host-kb_goauth" : "kb_goauth"
  const COOKIE_REFRESH_MS = 24 * 3600 * 1000
  const stateKey = deriveKey(cfg.sessionSecret, "oauth-state")
  const general = new RateLimiter(240, 60_000, now)
  const authLimit = new RateLimiter(30, 60_000, now)
  const pending = new Map() // повторные запросы статуса публикации

  const cookie = (name, value, maxAgeSec) =>
    [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      cfg.secureCookies ? "Secure" : "",
      `Max-Age=${maxAgeSec}`,
    ]
      .filter(Boolean)
      .join("; ")

  const clientIp = (req) =>
    (cfg.trustProxy &&
      (req.headers["x-real-ip"] ||
        String(req.headers["x-forwarded-for"] ?? "")
          .split(",")[0]
          .trim())) ||
    req.socket.remoteAddress ||
    "?"

  /** Сессия по cookie (без обращения к GitHub). */
  function sessionOf(req) {
    const sid = parseCookies(req.headers.cookie)[cookieName]
    const s = sessions.get(sid)
    return s ? { sid, s } : null
  }

  function requireSession(req) {
    const hit = sessionOf(req)
    if (!hit) throw new HttpError(401, "Нужно войти")
    const { sid, s } = hit
    // старые сессии хранили токены GitHub в себе — переносим в общее хранилище
    if (s.token) {
      if (!tokens.has(s.login)) tokens.set(s.login, s)
      sessions.touch(sid, {
        token: undefined,
        tokenExp: undefined,
        refresh: undefined,
        refreshExp: undefined,
      })
    }
    return { sid, session: sessions.touch(sid) }
  }

  /** Сессия + действующий токен GitHub (токены GitHub App живут 8 часов). */
  async function requireToken(req) {
    const { sid, session } = requireSession(req)
    try {
      return { sid, session, token: await tokens.get(session.login) }
    } catch (e) {
      if (e instanceof TokenError) throw new HttpError(401, e.message, { error: "github" })
      throw e
    }
  }

  /** Обёртка над вызовами GitHub: 401 от GitHub — значит токен отозван. */
  async function gh(sid, fn) {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof GitHubError) {
        if (e.status === 401) {
          const s = sessions.get(sid)
          if (s) tokens.drop(s.login)
          throw new HttpError(401, "GitHub отозвал доступ, войдите снова", { error: "github" })
        }
        if (e.status === 403 || e.status === 404) {
          throw new HttpError(
            e.status === 404 ? 404 : 403,
            e.status === 404
              ? "Не найдено"
              : "Нет доступа к репозиторию — проверьте установку GitHub App",
          )
        }
      }
      throw e
    }
  }

  /* Inbox.md: читаем, меняем и записываем с повтором, если файл успели поменять */
  async function readInbox(sid, token) {
    const f = await currentFile(sid, token, cfg.inboxPath)
    return f ?? { sha: null, content: "" }
  }

  async function mutateInbox(sid, token, change, message) {
    for (let attempt = 0; ; attempt++) {
      const f = await readInbox(sid, token)
      const next = change(f.content)
      if (next === null)
        throw new HttpError(409, "Эта мысль уже изменилась — обновите список", { error: "gone" })
      try {
        const r = await gh(sid, () =>
          github.putFile(
            token,
            cfg.inboxPath,
            Buffer.from(next, "utf8").toString("base64"),
            f.sha,
            message,
          ),
        )
        return { sha: r.sha, commit: r.commit, items: publicItems(next) }
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422) && attempt < 2)
          continue
        throw e
      }
    }
  }

  const inboxText = (v) => {
    const t = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : ""
    if (!t) throw new BadRequest("Пустая мысль")
    if (t.length > 20000) throw new BadRequest("Слишком длинный текст")
    return t
  }

  /** Доска задач: ошибки Google превращаем в понятные ответы. */
  async function board(fn) {
    needTasks()
    if (!tasks.connected) throw new HttpError(409, "Google Tasks не подключён", { error: "gtasks" })
    try {
      return await fn()
    } catch (e) {
      if (e.status === 404)
        throw new HttpError(404, "Задача или список не найдены — обновите страницу")
      if (e.status === 400) throw new BadRequest(e.message)
      if (e instanceof HttpError) throw e
      throw new HttpError(502, e.message || "Google Tasks не ответил")
    }
  }
  const str = (v, name) => {
    if (typeof v !== "string" || !v || v.length > 300) throw new BadRequest(`Нет поля ${name}`)
    return v
  }
  const dateOrNull = (v) => {
    if (v === null || v === "") return null
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
    throw new BadRequest("Дата в формате ГГГГ-ММ-ДД")
  }

  function needTasks() {
    if (!google?.enabled || !tasks) {
      throw new HttpError(501, "Google Tasks не настроен на сервере (GOOGLE_CLIENT_ID)")
    }
  }

  async function currentFile(sid, token, path) {
    return gh(sid, () => github.getFile(token, path))
  }

  const routes = {
    "GET /api/health": async () => ({ ok: true }),

    "GET /api/auth/login": async (req, res, url) => {
      const state = randomId(24)
      const value = seal(stateKey, {
        state,
        next: safeNext(url.searchParams.get("next")),
        ts: now(),
      })
      redirect(res, github.authorizeUrl(state), {
        "Set-Cookie": cookie(stateCookie, value, STATE_TTL / 1000),
      })
    },

    "GET /api/auth/callback": async (req, res, url) => {
      const cleared = cookie(stateCookie, "", 0)
      const saved = open(stateKey, parseCookies(req.headers.cookie)[stateCookie])
      const state = url.searchParams.get("state") ?? ""
      const code = url.searchParams.get("code")
      const next = safeNext(saved?.next)
      const back = (status) => {
        const u = new URL(next, cfg.siteOrigin)
        u.searchParams.set("kb-auth", status)
        redirect(res, u.pathname + u.search, { "Set-Cookie": cleared })
      }
      if (!saved || !safeEqual(saved.state, state) || now() - saved.ts > STATE_TTL || !code) {
        return back("error")
      }
      let t, user
      try {
        t = await github.exchangeCode(code)
        user = await github.getUser(t.token)
      } catch (e) {
        log.warn?.(`oauth failed: ${e.message}`)
        return back("error")
      }
      if (!cfg.allowedUsers.includes(String(user.login).toLowerCase())) {
        log.warn?.(`login denied for ${user.login}`)
        return back("denied")
      }
      tokens.set(user.login, t)
      const sid = sessions.create({
        login: user.login,
        name: user.name ?? user.login,
        avatar: user.avatar_url ?? null,
        cookieAt: now(),
      })
      log.info?.(`login ${user.login}`)
      const u = new URL(next, cfg.siteOrigin)
      u.searchParams.set("kb-auth", "ok")
      res.writeHead(302, {
        Location: u.pathname + u.search,
        "Cache-Control": "no-store",
        "Set-Cookie": [cleared, cookie(cookieName, sid, cfg.sessionTtlMs / 1000)],
      })
      res.end()
    },

    "POST /api/auth/logout": async (req, res) => {
      const sid = parseCookies(req.headers.cookie)[cookieName]
      sessions.delete(sid)
      send(res, 200, { ok: true }, { "Set-Cookie": cookie(cookieName, "", 0) })
    },

    "GET /api/me": async (req, res) => {
      const { sid, session } = requireSession(req)
      const headers = {}
      // cookie живёт SESSION_TTL_DAYS с последнего обновления: раз в сутки продлеваем
      if (!session.cookieAt || now() - session.cookieAt > COOKIE_REFRESH_MS) {
        sessions.touch(sid, { cookieAt: now() })
        headers["Set-Cookie"] = cookie(cookieName, sid, cfg.sessionTtlMs / 1000)
      }
      send(
        res,
        200,
        {
          login: session.login,
          name: session.name,
          avatar: session.avatar,
          repo: cfg.repo,
          branch: cfg.branch,
          github: tokens.has(session.login),
          gtasks: Boolean(google?.enabled),
        },
        headers,
      )
    },

    // Для nginx auth_request: весь сайт открыт только после входа. Без обращений к GitHub.
    "GET /api/auth/check": async (req, res) => {
      const hit = sessionOf(req)
      if (hit) sessions.touch(hit.sid)
      res.writeHead(hit ? 204 : 401, { "Cache-Control": "no-store" })
      res.end()
    },

    /* ───── Google Tasks ───── */

    "GET /api/gtasks/status": async (req) => {
      requireSession(req)
      needTasks()
      return tasks.status()
    },

    "GET /api/gtasks/connect": async (req, res) => {
      const { session } = requireSession(req)
      needTasks()
      const state = randomId(24)
      const value = seal(stateKey, { state, login: session.login, ts: now() })
      redirect(res, google.authorizeUrl(state), {
        "Set-Cookie": cookie(gStateCookie, value, STATE_TTL / 1000),
      })
    },

    "GET /api/gtasks/callback": async (req, res, url) => {
      needTasks()
      const cleared = cookie(gStateCookie, "", 0)
      const back = (status) => redirect(res, `/?kb-gtasks=${status}`, { "Set-Cookie": cleared })
      const hit = sessionOf(req)
      const saved = open(stateKey, parseCookies(req.headers.cookie)[gStateCookie])
      const state = url.searchParams.get("state") ?? ""
      const code = url.searchParams.get("code")
      if (
        !hit ||
        !saved ||
        saved.login !== hit.s.login ||
        !safeEqual(saved.state, state) ||
        now() - saved.ts > STATE_TTL ||
        !code
      ) {
        return back(url.searchParams.get("error") === "access_denied" ? "denied" : "error")
      }
      try {
        const t = await google.exchangeCode(code)
        if (!t.refresh) throw new Error("Google не выдал refresh-токен")
        tasks.connect(hit.s.login, t)
      } catch (e) {
        log.warn?.(`google oauth failed: ${e.message}`)
        return back("error")
      }
      log.info?.(`google tasks connected by ${hit.s.login}`)
      tasks.run("connect").catch(() => {})
      back("ok")
    },

    "POST /api/gtasks/sync": async (req) => {
      requireSession(req)
      needTasks()
      if (!tasks.connected) throw new HttpError(409, "Google Tasks не подключён")
      try {
        const stats = await tasks.run("manual")
        return { ok: true, stats, status: tasks.status() }
      } catch (e) {
        throw new HttpError(502, e.message, { status: tasks.status() })
      }
    },

    /* ───── Inbox ───── */

    "GET /api/inbox": async (req) => {
      const { sid, token } = await requireToken(req)
      const f = await readInbox(sid, token)
      return { sha: f.sha, path: cfg.inboxPath, items: publicItems(f.content) }
    },

    "POST /api/inbox": async (req) => {
      const { sid, token } = await requireToken(req)
      const body = await readJson(req)
      const text = inboxText(body.text)
      const at =
        typeof body.at === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(body.at)
          ? body.at
          : null
      const [date, time] = (
        at ?? new Date(now()).toISOString().slice(0, 16).replace("T", " ")
      ).split(" ")
      return mutateInbox(sid, token, (c) => addItem(c, { date, time, text }), "Inbox: новая мысль")
    },

    "PUT /api/inbox": async (req) => {
      const { sid, token } = await requireToken(req)
      const body = await readJson(req)
      const text = inboxText(body.text)
      const id = str(body.id, "id")
      return mutateInbox(sid, token, (c) => updateItem(c, id, text), "Inbox: правка мысли")
    },

    "DELETE /api/inbox": async (req) => {
      const { sid, token } = await requireToken(req)
      const body = await readJson(req)
      const id = str(body.id, "id")
      return mutateInbox(sid, token, (c) => removeItem(c, id), "Inbox: мысль удалена")
    },

    /* ───── доска задач ───── */

    "GET /api/gtasks/board": async (req) => {
      requireSession(req)
      return board(() => tasks.board())
    },

    "POST /api/gtasks/task": async (req) => {
      requireSession(req)
      const b = await readJson(req)
      return board(() =>
        tasks.createTask({
          listId: str(b.listId, "listId"),
          title: inboxText(b.title),
          due: b.due ? dateOrNull(b.due) : null,
          notes: typeof b.notes === "string" ? b.notes : "",
          previous: typeof b.previous === "string" ? b.previous : null,
        }),
      )
    },

    "PATCH /api/gtasks/task": async (req) => {
      requireSession(req)
      const b = await readJson(req)
      return board(() =>
        tasks.updateTask({
          listId: str(b.listId, "listId"),
          id: str(b.id, "id"),
          title: b.title === undefined ? undefined : inboxText(b.title),
          notes: typeof b.notes === "string" ? b.notes : undefined,
          due: b.due === undefined ? undefined : dateOrNull(b.due),
          done: typeof b.done === "boolean" ? b.done : undefined,
        }),
      )
    },

    "DELETE /api/gtasks/task": async (req) => {
      requireSession(req)
      const b = await readJson(req)
      await board(() => tasks.removeTask({ listId: str(b.listId, "listId"), id: str(b.id, "id") }))
      return { ok: true }
    },

    "POST /api/gtasks/move": async (req) => {
      requireSession(req)
      const b = await readJson(req)
      return board(() =>
        tasks.moveTask({
          listId: str(b.listId, "listId"),
          id: str(b.id, "id"),
          previous: typeof b.previous === "string" ? b.previous : null,
          toListId: typeof b.toListId === "string" ? b.toListId : null,
        }),
      )
    },

    "PUT /api/gtasks/prefs": async (req) => {
      requireSession(req)
      needTasks()
      return tasks.setPrefs(await readJson(req))
    },

    "POST /api/gtasks/disconnect": async (req) => {
      requireSession(req)
      needTasks()
      tasks.disconnect()
      return { ok: true }
    },

    "GET /api/file": async (req, res, url) => {
      const { sid, token } = await requireToken(req)
      const path = notePath(url.searchParams.get("path"))
      const file = await currentFile(sid, token, path)
      if (!file) throw new HttpError(404, "Файл не найден")
      return file
    },

    "PUT /api/file": async (req) => {
      const { sid, token } = await requireToken(req)
      const body = await readJson(req)
      const path = notePath(body.path)
      if (typeof body.content !== "string") throw new BadRequest("Нет содержимого")
      const sha = body.sha ? String(body.sha) : null
      const message =
        String(body.message ?? "")
          .trim()
          .slice(0, 200) ||
        (sha ? `Правка «${titleOf(path)}» с сайта` : `Новая заметка «${titleOf(path)}» с сайта`)
      try {
        const r = await gh(sid, () =>
          github.putFile(
            token,
            path,
            Buffer.from(body.content, "utf8").toString("base64"),
            sha,
            message,
          ),
        )
        return { path, ...r }
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
          const current = await currentFile(sid, token, path)
          if (!sha && current)
            throw new HttpError(409, "Заметка с таким именем уже есть", { error: "exists" })
          throw new HttpError(409, "Файл изменился, пока вы его редактировали", {
            error: "conflict",
            current,
          })
        }
        throw e
      }
    },

    "DELETE /api/file": async (req) => {
      const { sid, token } = await requireToken(req)
      const body = await readJson(req)
      const path = notePath(body.path)
      if (!body.sha) throw new BadRequest("Нет версии файла (sha)")
      try {
        return await gh(sid, () =>
          github.deleteFile(
            token,
            path,
            String(body.sha),
            `Удалена заметка «${titleOf(path)}» с сайта`,
          ),
        )
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
          throw new HttpError(409, "Файл изменился — обновите страницу", { error: "conflict" })
        }
        throw e
      }
    },

    "POST /api/move": async (req) => {
      const { sid, token } = await requireToken(req)
      const body = await readJson(req)
      const from = notePath(body.from)
      const to = notePath(body.to)
      if (from === to) throw new BadRequest("Путь не изменился")
      if (await gh(sid, () => github.exists(token, to))) {
        throw new HttpError(409, "По этому пути уже есть файл", { error: "exists" })
      }
      const message = `Перенос «${titleOf(from)}» → ${to} с сайта`
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await gh(sid, () => github.move(token, from, to, message))
          return { path: to, ...r }
        } catch (e) {
          // ветка ушла вперёд между чтением и записью — пробуем ещё раз
          if (e instanceof GitHubError && e.status === 422 && attempt < 2) continue
          throw e
        }
      }
    },

    "POST /api/upload": async (req, res, url) => {
      const { sid, token } = await requireToken(req)
      const { stem, ext } = uploadName(url.searchParams.get("name") ?? "")
      const buf = await readBody(req, cfg.maxUploadBytes)
      if (buf.length === 0) throw new BadRequest("Пустой файл")
      checkFileContent(ext, buf)
      let name = `${stem}.${ext}`
      for (let i = 1; await gh(sid, () => github.exists(token, `attachments/${name}`)); i++) {
        if (i > 50) throw new HttpError(409, "Не удалось подобрать свободное имя файла")
        name = `${stem}-${i}.${ext}`
      }
      const path = `attachments/${name}`
      const r = await gh(sid, () =>
        github.putFile(token, path, buf.toString("base64"), null, `Вложение ${name} с сайта`),
      )
      return { path, name, ...r }
    },

    "GET /api/tree": async (req) => {
      const { sid, token } = await requireToken(req)
      const tree = await gh(sid, () => github.tree(token))
      const visible = (p) => !p.split("/").some((s) => s.startsWith("."))
      return {
        dirs: tree
          .filter((e) => e.type === "tree" && visible(e.path))
          .map((e) => e.path)
          .sort(),
        notes: tree
          .filter((e) => e.type === "blob" && visible(e.path) && /\.md$/i.test(e.path))
          .map((e) => e.path),
        attachments: tree
          .filter((e) => e.type === "blob" && e.path.startsWith("attachments/"))
          .map((e) => e.path.slice("attachments/".length)),
      }
    },

    "GET /api/deploy": async (req, res, url) => {
      const { sid, token } = await requireToken(req)
      const sha = url.searchParams.get("sha") ?? ""
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new BadRequest("Некорректный sha")
      // кешируем на 4 секунды, чтобы несколько вкладок не долбили GitHub
      const hit = pending.get(sha)
      if (hit && now() - hit.t < 4000) return hit.v
      const v = await gh(sid, () => github.deployStatus(token, sha))
      pending.set(sha, { t: now(), v })
      if (pending.size > 200) pending.clear()
      return v
    },
  }

  return async function handler(req, res) {
    const url = new URL(req.url ?? "/", "http://kb.local")
    const key = `${req.method} ${url.pathname.replace(/\/+$/, "")}`
    try {
      const ip = clientIp(req)
      const isCheck = url.pathname === "/api/auth/check"
      const isAuth = url.pathname.startsWith("/api/auth/") && !isCheck
      if (!isCheck && (!general.check(ip) || (isAuth && !authLimit.check(ip)))) {
        throw new HttpError(429, "Слишком много запросов, подождите минуту")
      }
      const route = routes[key]
      if (!route) throw new HttpError(404, "Нет такого метода API")
      // защита от CSRF: изменяющие запросы только со своего сайта и только из нашего JS
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.headers.origin !== cfg.siteOrigin || req.headers["x-kb-request"] !== "1") {
          throw new HttpError(403, "Запрос отклонён (CSRF)")
        }
      }
      const out = await route(req, res, url)
      if (!res.headersSent) send(res, 200, out)
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500
      if (status >= 500) log.error?.(`${key}: ${e.stack ?? e.message}`)
      if (!res.headersSent) {
        send(res, status, {
          error: e.extra?.error ?? (status === 500 ? "internal" : "error"),
          message: status === 500 ? "Внутренняя ошибка сервера" : e.message,
          ...(e.extra ?? {}),
        })
      } else res.end()
    }
  }
}
