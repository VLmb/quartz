// Запросы к kb-api для пространств (Inbox, задачи).

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: any = null,
  ) {
    super(message)
  }
}

let base = "/api/"

export function setBase(root: string) {
  base = new URL("api/", new URL(root, location.href)).pathname
}

export async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(base + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(method !== "GET" ? { "X-KB-Request": "1" } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new HttpError(0, "Нет связи с сервером")
  }
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok) throw new HttpError(res.status, data?.message ?? `Ошибка ${res.status}`, data)
  return data as T
}

export function loginUrl(): string {
  return `${base}auth/login?next=${encodeURIComponent(location.pathname + location.search)}`
}
