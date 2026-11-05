// Проверка путей: редактор может трогать только заметки и вложения,
// не служебные файлы (.github, .obsidian) и не выходить за пределы репозитория.

export class BadRequest extends Error {
  constructor(message) {
    super(message)
    this.status = 400
  }
}

const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f<>:"|?*#%^[\]\\]/

function cleanSegments(p) {
  if (typeof p !== "string" || !p.trim()) throw new BadRequest("Пустой путь")
  const norm = p
    .normalize("NFC")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim()
  if (norm.length > 300) throw new BadRequest("Слишком длинный путь")
  const segs = norm.split("/")
  for (const s of segs) {
    if (!s || s === "." || s === "..") throw new BadRequest("Недопустимый путь")
    if (s.startsWith(".")) throw new BadRequest("Служебные файлы и папки редактировать нельзя")
    if (s !== s.trim()) throw new BadRequest("Имя не может начинаться или заканчиваться пробелом")
    if (FORBIDDEN_CHARS.test(s)) {
      throw new BadRequest(`Недопустимые символы в «${s}»: нельзя # % ? : | ^ [ ] * < > " \\`)
    }
  }
  return segs
}

/** Путь к заметке: только .md. */
export function notePath(p) {
  const segs = cleanSegments(p)
  const out = segs.join("/")
  if (!/\.md$/i.test(out)) throw new BadRequest("Можно редактировать только .md-файлы")
  return out
}

export const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
}

/** Имя файла для attachments/: латиница, кириллица, цифры, - _ . */
export function uploadName(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new BadRequest("Не указано имя файла")
  const base = raw.normalize("NFC").split(/[\\/]/).pop().trim()
  const m = base.match(/^(.*?)(?:\.([A-Za-z0-9]+))?$/)
  const ext = (m?.[2] ?? "").toLowerCase()
  if (!IMAGE_TYPES[ext]) {
    throw new BadRequest(`Можно загружать только: ${Object.keys(IMAGE_TYPES).join(", ")}`)
  }
  let stem = (m?.[1] ?? "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  if (!stem) stem = "image"
  return { stem, ext, name: `${stem}.${ext}` }
}

/** Проверяем, что содержимое похоже на заявленный тип (и что SVG без скриптов). */
export function checkFileContent(ext, buf) {
  const head = buf.subarray(0, 16)
  const hex = head.toString("hex")
  const ok = {
    png: () => hex.startsWith("89504e470d0a1a0a"),
    jpg: () => hex.startsWith("ffd8ff"),
    jpeg: () => hex.startsWith("ffd8ff"),
    gif: () => head.toString("latin1").startsWith("GIF8"),
    webp: () =>
      head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP",
    avif: () => head.toString("latin1", 4, 12).startsWith("ftypavi"),
    pdf: () => head.toString("latin1").startsWith("%PDF"),
    svg: () => {
      const text = buf.toString("utf8")
      if (!/<svg[\s>]/i.test(text)) return false
      if (/<script|\son\w+\s*=|javascript:|<foreignObject/i.test(text)) {
        throw new BadRequest("SVG со скриптами загружать нельзя")
      }
      return true
    },
  }[ext]
  if (!ok || !ok()) throw new BadRequest("Содержимое файла не соответствует расширению")
}

export function titleOf(p) {
  return p.split("/").pop().replace(/\.md$/i, "")
}
