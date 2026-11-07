// Поддельный GitHub для тестов и локальной разработки: OAuth GitHub App,
// Contents API, Git Data API (для переноса) и Actions runs. Всё в памяти.
import http from "node:http"
import { createHash, randomBytes } from "node:crypto"

const blobSha = (buf) =>
  createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest("hex")
const rnd = () => randomBytes(20).toString("hex")

export function startMockGitHub({
  login = "VLmb",
  files = {},
  port = 0,
  repo = "VLmb/knowledge",
  branch = "main",
} = {}) {
  const state = {
    files: new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)])),
    head: rnd(),
    commits: new Map(), // sha -> { tree: Map snapshot }
    trees: new Map(),
    runs: new Map(), // commit sha -> calls
    tokens: new Map(), // token -> login
    codes: new Map(),
    refreshes: new Map(),
    log: [],
    login,
  }
  state.commits.set(state.head, { files: new Map(state.files) })

  const commit = (message) => {
    const sha = rnd()
    state.commits.set(sha, { files: new Map(state.files), message })
    state.head = sha
    state.log.push(message)
    return sha
  }

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }
  const readJson = (req) =>
    new Promise((r) => {
      let s = ""
      req.on("data", (c) => (s += c))
      req.on("end", () => r(s ? JSON.parse(s) : {}))
    })
  const issueToken = (who) => {
    const t = `ghu_${rnd()}`
    const rt = `ghr_${rnd()}`
    state.tokens.set(t, who)
    state.refreshes.set(rt, who)
    return {
      access_token: t,
      expires_in: 28800,
      refresh_token: rt,
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://mock")
    const p = decodeURIComponent(url.pathname)

    // ── OAuth
    if (p === "/login/oauth/authorize") {
      const code = rnd()
      state.codes.set(code, state.login)
      const back = new URL(url.searchParams.get("redirect_uri"))
      back.searchParams.set("code", code)
      back.searchParams.set("state", url.searchParams.get("state"))
      res.writeHead(302, { Location: back.toString() })
      return res.end()
    }
    if (p === "/login/oauth/access_token") {
      const body = await readJson(req)
      if (body.grant_type === "refresh_token") {
        const who = state.refreshes.get(body.refresh_token)
        if (!who) return send(res, 200, { error: "bad_refresh_token" })
        state.refreshes.delete(body.refresh_token)
        return send(res, 200, issueToken(who))
      }
      const who = state.codes.get(body.code)
      if (!who) return send(res, 200, { error: "bad_verification_code" })
      state.codes.delete(body.code)
      return send(res, 200, issueToken(who))
    }

    // ── API: авторизация
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "")
    const who = state.tokens.get(token)
    if (!who) return send(res, 401, { message: "Bad credentials" })
    if (p === "/user") return send(res, 200, { login: who, name: `${who} Name`, avatar_url: null })

    const base = `/repos/${repo}`
    if (!p.startsWith(base)) return send(res, 404, { message: "Not Found" })
    const rest = p.slice(base.length)

    // ── Contents
    if (rest.startsWith("/contents/")) {
      const path = rest.slice("/contents/".length)
      const ref = url.searchParams.get("ref")
      const files = ref && state.commits.has(ref) ? state.commits.get(ref).files : state.files
      if (req.method === "GET") {
        const buf = files.get(path)
        if (!buf) {
          const isDir = [...files.keys()].some((k) => k.startsWith(path + "/"))
          return isDir
            ? send(res, 200, [{ type: "file" }])
            : send(res, 404, { message: "Not Found" })
        }
        return send(res, 200, {
          type: "file",
          path,
          sha: blobSha(buf),
          size: buf.length,
          encoding: "base64",
          content: buf.toString("base64").replace(/(.{60})/g, "$1\n"),
          html_url: `https://github.com/${repo}/blob/${branch}/${path}`,
        })
      }
      const body = await readJson(req)
      const cur = state.files.get(path)
      if (req.method === "PUT") {
        if (cur && !body.sha) return send(res, 422, { message: '"sha" wasn\'t supplied.' })
        if (cur && body.sha !== blobSha(cur)) return send(res, 409, { message: "does not match" })
        if (!cur && body.sha) return send(res, 404, { message: "Not Found" })
        const buf = Buffer.from(body.content, "base64")
        state.files.set(path, buf)
        const c = commit(body.message)
        return send(res, cur ? 200 : 201, {
          content: { sha: blobSha(buf), path },
          commit: { sha: c },
        })
      }
      if (req.method === "DELETE") {
        if (!cur) return send(res, 404, { message: "Not Found" })
        if (body.sha !== blobSha(cur)) return send(res, 409, { message: "does not match" })
        state.files.delete(path)
        return send(res, 200, { commit: { sha: commit(body.message) } })
      }
    }

    // ── Git Data API (перенос файла)
    if (rest === `/git/ref/heads/${branch}`) return send(res, 200, { object: { sha: state.head } })
    if (rest.startsWith("/git/commits/") && req.method === "GET") {
      const sha = rest.split("/").pop()
      if (!state.commits.has(sha)) return send(res, 404, { message: "Not Found" })
      return send(res, 200, { sha, tree: { sha: `tree-${sha}` } })
    }
    if (rest === "/git/trees" && req.method === "POST") {
      const body = await readJson(req)
      const baseCommit = body.base_tree.replace(/^tree-/, "")
      const files = new Map(state.commits.get(baseCommit).files)
      for (const e of body.tree) {
        if (e.sha === null) files.delete(e.path)
        else if (typeof e.content === "string") files.set(e.path, Buffer.from(e.content))
        else {
          const src = [...files.values(), ...state.files.values()].find((b) => blobSha(b) === e.sha)
          files.set(e.path, src)
        }
      }
      const sha = rnd()
      state.trees.set(sha, files)
      return send(res, 201, { sha })
    }
    if (rest === "/git/commits" && req.method === "POST") {
      const body = await readJson(req)
      const sha = rnd()
      state.commits.set(sha, {
        files: state.trees.get(body.tree),
        message: body.message,
        parent: body.parents[0],
      })
      return send(res, 201, { sha })
    }
    if (rest === `/git/refs/heads/${branch}` && req.method === "PATCH") {
      const body = await readJson(req)
      const c = state.commits.get(body.sha)
      if (c.parent !== state.head)
        return send(res, 422, { message: "Update is not a fast forward" })
      state.files = new Map(c.files)
      state.head = body.sha
      state.log.push(c.message)
      return send(res, 200, { object: { sha: body.sha } })
    }
    if (rest.startsWith("/git/blobs/")) {
      const sha = rest.split("/").pop()
      const all = [state.files, ...[...state.commits.values()].map((c) => c.files)]
      for (const m of all)
        for (const v of m.values())
          if (blobSha(v) === sha)
            return send(res, 200, { sha, encoding: "base64", content: v.toString("base64") })
      return send(res, 404, { message: "Not Found" })
    }
    if (rest.startsWith(`/git/trees/`)) {
      const tree = []
      const dirs = new Set()
      for (const [k, v] of state.files) {
        tree.push({ path: k, type: "blob", sha: blobSha(v) })
        const parts = k.split("/")
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"))
      }
      for (const d of dirs) tree.push({ path: d, type: "tree" })
      return send(res, 200, { tree })
    }

    // ── Actions: первый запрос — «идёт сборка», затем успех
    if (rest === "/actions/runs") {
      const sha = url.searchParams.get("head_sha")
      const n = (state.runs.get(sha) ?? 0) + 1
      state.runs.set(sha, n)
      const run =
        n === 1
          ? { status: "in_progress", conclusion: null }
          : { status: "completed", conclusion: "success" }
      return send(res, 200, {
        workflow_runs: [{ ...run, html_url: `https://github.com/${repo}/actions/runs/1` }],
      })
    }

    send(res, 404, { message: "Not Found" })
  })

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`
      resolve({
        url,
        state,
        blobSha,
        /** Имитация правки из Obsidian (другой коммит в ту же ветку). */
        externalEdit(path, content) {
          state.files.set(path, Buffer.from(content))
          commit(`vault: внешняя правка ${path}`)
        },
        close: () =>
          new Promise((r) => {
            server.closeAllConnections()
            server.close(r)
          }),
      })
    })
  })
}

// Запуск отдельно: node tests/mock-github.mjs 8790
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 8790)
  startMockGitHub({ port }).then((m) => console.log(`mock GitHub: ${m.url}`))
}
