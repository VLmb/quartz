import fs from "node:fs"
import path from "node:path"
import { open, randomId, seal, sha256 } from "./crypto.mjs"

/**
 * Сессии живут в памяти и сохраняются на диск зашифрованными.
 * Ключ записи — хеш идентификатора из cookie, поэтому утечка файла
 * не даёт ни cookie, ни токенов GitHub.
 */
export class SessionStore {
  constructor({ file, key, ttlMs, now = () => Date.now() }) {
    this.file = file
    this.key = key
    this.ttlMs = ttlMs
    this.now = now
    this.map = new Map()
    this.timer = null
    this.load()
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return
    const data = open(this.key, fs.readFileSync(this.file, "utf8").trim())
    if (!data || typeof data !== "object") return
    for (const [k, v] of Object.entries(data)) this.map.set(k, v)
    this.prune()
  }

  prune() {
    const t = this.now()
    for (const [k, v] of this.map) if (v.expiresAt <= t) this.map.delete(k)
  }

  create(data) {
    const sid = randomId()
    const t = this.now()
    this.map.set(sha256(sid), { ...data, createdAt: t, seenAt: t, expiresAt: t + this.ttlMs })
    this.save()
    return sid
  }

  get(sid) {
    if (!sid) return null
    const s = this.map.get(sha256(sid))
    if (!s) return null
    if (s.expiresAt <= this.now()) {
      this.delete(sid)
      return null
    }
    return s
  }

  /** Продлевает сессию при использовании (скользящий срок). */
  touch(sid, patch = {}) {
    const k = sha256(sid)
    const s = this.map.get(k)
    if (!s) return null
    const t = this.now()
    const next = { ...s, ...patch, seenAt: t, expiresAt: t + this.ttlMs }
    this.map.set(k, next)
    if (Object.keys(patch).length || t - s.seenAt > 3600_000) this.save()
    return next
  }

  delete(sid) {
    if (sid && this.map.delete(sha256(sid))) this.save()
  }

  save() {
    if (!this.file) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 200)
  }

  flush() {
    if (!this.file) return
    clearTimeout(this.timer)
    this.prune()
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, seal(this.key, Object.fromEntries(this.map)), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
}
