// Маленькое зашифрованное JSON-хранилище в файле (токены и состояние синхронизации).
import fs from "node:fs"
import path from "node:path"
import { open, seal } from "./crypto.mjs"

export class SecretStore {
  constructor(file, key) {
    this.file = file
    this.key = key
    this.data = {}
    if (file && fs.existsSync(file)) {
      const d = open(key, fs.readFileSync(file, "utf8").trim())
      if (d && typeof d === "object") this.data = d
    }
  }

  get(k, fallback = null) {
    return this.data[k] ?? fallback
  }

  set(k, v) {
    if (v === null || v === undefined) delete this.data[k]
    else this.data[k] = v
    this.save()
  }

  save() {
    if (!this.file) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, seal(this.key, this.data), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
}
