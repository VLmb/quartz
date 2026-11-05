#!/usr/bin/env node
// kb-api — бэкенд редактора базы знаний. Слушает только localhost, снаружи доступен через nginx /api/.
import http from "node:http"
import path from "node:path"
import { loadConfig } from "./config.mjs"
import { deriveKey } from "./crypto.mjs"
import { GitHub } from "./github.mjs"
import { SessionStore } from "./sessions.mjs"
import { createApp } from "./app.mjs"

const cfg = loadConfig()
const sessions = new SessionStore({
  file: path.join(cfg.dataDir, "sessions.enc"),
  key: deriveKey(cfg.sessionSecret, "sessions"),
  ttlMs: cfg.sessionTtlMs,
})
const github = new GitHub(cfg)
const log = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
}
const server = http.createServer(createApp(cfg, { github, sessions, log }))
server.requestTimeout = 120_000
server.headersTimeout = 30_000

server.listen(cfg.port, cfg.host, () => {
  console.log(
    `kb-api слушает http://${cfg.host}:${cfg.port}, репозиторий ${cfg.repo}@${cfg.branch}`,
  )
})

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    sessions.flush()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
