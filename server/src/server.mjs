#!/usr/bin/env node
// kb-api — бэкенд редактора базы знаний. Слушает только localhost, снаружи доступен через nginx /api/.
import http from "node:http"
import path from "node:path"
import { loadConfig } from "./config.mjs"
import { deriveKey } from "./crypto.mjs"
import { GitHub } from "./github.mjs"
import { SessionStore } from "./sessions.mjs"
import { createApp } from "./app.mjs"
import { SecretStore } from "./store.mjs"
import { TokenKeeper } from "./tokens.mjs"
import { Google } from "./google.mjs"
import { TaskSync } from "./tasksync.mjs"

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
const tokens = new TokenKeeper({
  store: new SecretStore(
    path.join(cfg.dataDir, "tokens.enc"),
    deriveKey(cfg.sessionSecret, "tokens"),
  ),
  github,
  log,
})
const google = new Google(cfg)
const tasks = google.enabled
  ? new TaskSync({
      cfg,
      github,
      google,
      tokens,
      store: new SecretStore(
        path.join(cfg.dataDir, "gtasks.enc"),
        deriveKey(cfg.sessionSecret, "gtasks"),
      ),
      log,
    })
  : null
const server = http.createServer(createApp(cfg, { github, sessions, tokens, google, tasks, log }))

// фоновая синхронизация задач
if (tasks) {
  const tick = () => {
    if (tasks.connected) tasks.run("timer").catch(() => {})
  }
  setTimeout(tick, 15_000).unref()
  setInterval(tick, cfg.gtasksIntervalMin * 60_000).unref()
  log.info(`Google Tasks: синхронизация каждые ${cfg.gtasksIntervalMin} мин`)
}
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
