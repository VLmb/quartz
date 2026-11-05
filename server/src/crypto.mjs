import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

export const randomId = (bytes = 32) => randomBytes(bytes).toString("base64url")

export const sha256 = (s) => createHash("sha256").update(s).digest("base64url")

export function deriveKey(secret, purpose) {
  return createHash("sha256").update(`kb-api:${purpose}:${secret}`).digest()
}

/** AES-256-GCM: iv(12) | tag(16) | шифртекст, в base64url. */
export function seal(key, value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")
}

export function open(key, sealed) {
  try {
    const buf = Buffer.from(String(sealed), "base64url")
    if (buf.length < 29) return null
    const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const out = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()])
    return JSON.parse(out.toString("utf8"))
  } catch {
    return null
  }
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
