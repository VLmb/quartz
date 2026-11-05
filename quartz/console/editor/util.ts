// Мелкие помощники редактора.

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  )

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (k === "class") e.className = String(v)
    else if (k === "html") e.innerHTML = String(v)
    else e.setAttribute(k, v === true ? "" : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c)
  return e
}

/** Как Quartz превращает путь файла в адрес страницы. */
export function slugify(path: string): string {
  return path
    .replace(/\.md$/i, "")
    .split("/")
    .map((s) =>
      s
        .replace(/\s/g, "-")
        .replace(/&/g, "-and-")
        .replace(/%/g, "-percent")
        .replace(/[?#]/g, "")
        .toLowerCase(),
    )
    .join("/")
    .replace(/(^|\/)index$/, "$1")
}

export const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "")
export const dirOf = (path: string) => path.split("/").slice(0, -1).join("/")

const FORBIDDEN = /[\u0000-\u001f<>:"|?*#%^[\]\\]/

/** Та же проверка, что на сервере, — чтобы ругаться до отправки. */
export function checkNotePath(path: string): string | null {
  const segs = path.split("/")
  for (const s of segs) {
    if (!s.trim()) return "Пустое имя папки или заметки"
    if (s.startsWith(".")) return "Имя не может начинаться с точки"
    if (s !== s.trim()) return "Лишние пробелы в начале или конце имени"
    if (FORBIDDEN.test(s)) return 'Нельзя использовать символы # % ? : | ^ [ ] * < > " \\'
  }
  if (!/\.md$/i.test(path)) return "Путь должен заканчиваться на .md"
  return null
}

export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return "только что"
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
}

export const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k)
      return v ? (JSON.parse(v) as T) : null
    } catch {
      return null
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {}
  },
  del(k: string) {
    try {
      localStorage.removeItem(k)
    } catch {}
  },
}

/** Построчный дифф (LCS) для разбора конфликтов. */
export function lineDiff(a: string, b: string): { t: " " | "-" | "+"; s: string }[] | null {
  const x = a.split("\n")
  const y = b.split("\n")
  if (x.length * y.length > 4_000_000) return null
  const n = x.length
  const m = y.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { t: " " | "-" | "+"; s: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) (out.push({ t: " ", s: x[i++] }), j++)
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "-", s: x[i++] })
    else out.push({ t: "+", s: y[j++] })
  }
  while (i < n) out.push({ t: "-", s: x[i++] })
  while (j < m) out.push({ t: "+", s: y[j++] })
  return out
}

/** Сжимаем большие фото с телефона перед загрузкой. */
export async function shrinkImage(file: File): Promise<Blob> {
  const big = file.size > 1.5 * 1024 * 1024
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !big) return file
  try {
    const bmp = await createImageBitmap(file)
    const max = 2400
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bmp.width * k)
    canvas.height = Math.round(bmp.height * k)
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const type = file.type === "image/png" ? "image/webp" : "image/jpeg"
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86))
    return out && out.size < file.size ? out : file
  } catch {
    return file
  }
}

export const extFor = (type: string) =>
  ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "application/pdf": "pdf",
  })[type] ?? "png"
