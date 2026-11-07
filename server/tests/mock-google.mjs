// Поддельный Google (OAuth + Tasks API v1) для тестов. Всё в памяти.
import http from "node:http"
import { randomBytes } from "node:crypto"

const rid = () => randomBytes(8).toString("hex")

export function startMockGoogle({ lists = [{ title: "Мои задачи" }] } = {}) {
  const state = {
    lists: lists.map((l) => ({ id: rid(), title: l.title })),
    tasks: new Map(), // listId -> Map(id -> task)
    codes: new Set(),
    refresh: new Set(),
    access: new Set(),
    calls: [],
  }
  for (const l of state.lists) state.tasks.set(l.id, new Map())

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(body === undefined ? "" : JSON.stringify(body))
  }
  const read = (req) =>
    new Promise((r) => {
      let s = ""
      req.on("data", (c) => (s += c))
      req.on("end", () => r(s))
    })
  const stamp = (t) => {
    t.updated = new Date().toISOString()
    if (t.status === "completed" && !t.completed) t.completed = new Date().toISOString()
    if (t.status !== "completed") delete t.completed
    if (t.due) t.due = String(t.due).slice(0, 10) + "T00:00:00.000Z" // Google отбрасывает время
    return t
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://g")
    const p = url.pathname
    state.calls.push(`${req.method} ${p}`)
    if (p === "/auth") {
      const code = `code-${rid()}`
      state.codes.add(code)
      const back = new URL(url.searchParams.get("redirect_uri"))
      back.searchParams.set("code", code)
      back.searchParams.set("state", url.searchParams.get("state"))
      res.writeHead(302, { Location: back.toString() })
      return res.end()
    }
    if (p === "/token") {
      const body = new URLSearchParams(await read(req))
      const ok =
        (body.get("grant_type") === "authorization_code" && state.codes.delete(body.get("code"))) ||
        (body.get("grant_type") === "refresh_token" && state.refresh.has(body.get("refresh_token")))
      if (!ok) return send(res, 400, { error: "invalid_grant" })
      const access = `ya29.${rid()}`
      state.access.add(access)
      const out = { access_token: access, expires_in: 3599, token_type: "Bearer" }
      if (body.get("grant_type") === "authorization_code") {
        out.refresh_token = `1//${rid()}`
        state.refresh.add(out.refresh_token)
      }
      return send(res, 200, out)
    }
    const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "")
    if (!state.access.has(auth)) return send(res, 401, { error: { message: "unauthorized" } })
    const body =
      req.method === "GET" || req.method === "DELETE" ? null : JSON.parse((await read(req)) || "{}")

    if (p === "/tasks/v1/users/@me/lists") {
      if (req.method === "GET") return send(res, 200, { items: state.lists })
      const l = { id: rid(), title: body.title }
      state.lists.push(l)
      state.tasks.set(l.id, new Map())
      return send(res, 200, l)
    }
    const m = /^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(p)
    if (m) {
      const list = state.tasks.get(decodeURIComponent(m[1]))
      if (!list) return send(res, 404, { error: { message: "list" } })
      const id = m[2] && decodeURIComponent(m[2])
      if (!id && req.method === "GET") return send(res, 200, { items: [...list.values()] })
      if (!id && req.method === "POST") {
        const t = stamp({ id: rid(), kind: "tasks#task", status: "needsAction", ...body })
        list.set(t.id, t)
        return send(res, 200, t)
      }
      const t = list.get(id)
      if (!t) return send(res, 404, { error: { message: "task" } })
      if (req.method === "PATCH") {
        for (const [k, v] of Object.entries(body)) {
          if (v === null) delete t[k]
          else t[k] = v
        }
        return send(res, 200, stamp(t))
      }
      if (req.method === "DELETE") {
        list.delete(id)
        return send(res, 204)
      }
    }
    send(res, 404, { error: { message: "not found" } })
  })

  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`
      resolve({
        url,
        state,
        list: (title) => state.lists.find((l) => l.title === title),
        all: () =>
          state.lists.flatMap((l) =>
            [...state.tasks.get(l.id).values()].map((t) => ({ ...t, list: l.title })),
          ),
        /** Правка «из приложения Google Tasks». */
        add(listTitle, task) {
          const l = state.lists.find((x) => x.title === listTitle)
          const t = stamp({ id: rid(), status: "needsAction", ...task })
          state.tasks.get(l.id).set(t.id, t)
          return t
        },
        edit(id, patch) {
          for (const list of state.tasks.values()) {
            const t = list.get(id)
            if (t) Object.assign(t, patch) && stamp(t)
          }
        },
        remove(id) {
          for (const list of state.tasks.values()) list.delete(id)
        },
        close: () =>
          new Promise((r) => {
            server.closeAllConnections()
            server.close(r)
          }),
      })
    }),
  )
}
