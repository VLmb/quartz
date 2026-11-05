// Обращения к kb-api. Все изменяющие запросы помечены заголовком X-KB-Request (защита от CSRF).

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: any = {},
  ) {
    super(message)
  }
}

export type FileData = { path: string; sha: string; content: string; htmlUrl?: string }
export type SaveResult = { path: string; sha: string; commit: string }
export type Tree = { dirs: string[]; notes: string[]; attachments: string[] }
export type Me = {
  login: string
  name: string
  avatar: string | null
  repo: string
  branch: string
}

let base = "/api"
export function setApiBase(root: string) {
  base = new URL("api", new URL(root, location.href)).pathname.replace(/\/$/, "")
}

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== "GET") headers["X-KB-Request"] = "1"
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (raw) headers["Content-Type"] = raw.type || "application/octet-stream"
  let res: Response
  try {
    res = await fetch(base + path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new ApiError(0, "Нет связи с сервером")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.message ?? `Ошибка ${res.status}`, data)
  return data as T
}

const q = (p: string) => `?path=${encodeURIComponent(p)}`

export const api = {
  me: () => call<Me>("GET", "/me"),
  logout: () => call("POST", "/auth/logout"),
  loginUrl: (next: string) => `${base}/auth/login?next=${encodeURIComponent(next)}`,
  getFile: (path: string) => call<FileData>("GET", `/file${q(path)}`),
  save: (path: string, content: string, sha: string | null, message?: string) =>
    call<SaveResult>("PUT", "/file", { path, content, sha, message }),
  remove: (path: string, sha: string) => call<{ commit: string }>("DELETE", "/file", { path, sha }),
  move: (from: string, to: string) => call<SaveResult>("POST", "/move", { from, to }),
  upload: (file: Blob, name: string) =>
    call<SaveResult & { name: string }>(
      "POST",
      `/upload?name=${encodeURIComponent(name)}`,
      undefined,
      file,
    ),
  tree: () => call<Tree>("GET", "/tree"),
  deploy: (sha: string) =>
    call<{ status: string; conclusion: string | null; url: string | null }>(
      "GET",
      `/deploy?sha=${sha}`,
    ),
}
