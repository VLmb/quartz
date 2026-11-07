// Клиент Google: OAuth (offline-доступ с refresh-токеном) и Google Tasks API v1.

export class GoogleError extends Error {
  constructor(status, message, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks"

export class Google {
  constructor(cfg, fetchImpl = fetch) {
    this.cfg = cfg
    this.fetch = fetchImpl
  }

  get enabled() {
    return Boolean(this.cfg.googleClientId && this.cfg.googleClientSecret)
  }

  redirectUri() {
    return `${this.cfg.siteOrigin}/api/gtasks/callback`
  }

  authorizeUrl(state) {
    const u = new URL(this.cfg.googleAuthUrl)
    u.searchParams.set("client_id", this.cfg.googleClientId)
    u.searchParams.set("redirect_uri", this.redirectUri())
    u.searchParams.set("response_type", "code")
    u.searchParams.set("scope", TASKS_SCOPE)
    u.searchParams.set("access_type", "offline")
    u.searchParams.set("prompt", "consent")
    u.searchParams.set("include_granted_scopes", "true")
    u.searchParams.set("state", state)
    return u.toString()
  }

  async token(params) {
    const res = await this.fetch(this.cfg.googleTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: this.cfg.googleClientId,
        client_secret: this.cfg.googleClientSecret,
        ...params,
      }).toString(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) {
      throw new GoogleError(
        res.status === 400 || res.status === 401 ? 401 : res.status || 500,
        data.error_description ?? data.error ?? "Google не выдал токен",
        data,
      )
    }
    return {
      access: data.access_token,
      accessExp: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      refresh: data.refresh_token ?? params.refresh_token ?? null,
    }
  }

  exchangeCode(code) {
    return this.token({ code, grant_type: "authorization_code", redirect_uri: this.redirectUri() })
  }

  refresh(refreshToken) {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken })
  }

  async request(access, method, path, body) {
    const res = await this.fetch(this.cfg.googleApi + path, {
      method,
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 204) return null
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {}
    if (!res.ok) {
      throw new GoogleError(
        res.status,
        data?.error?.message ?? `Google ответил ${res.status}`,
        data,
      )
    }
    return data
  }

  /* ───── Tasks API ───── */

  async lists(access) {
    const out = []
    let page = ""
    do {
      const q = new URLSearchParams({ maxResults: "100", ...(page ? { pageToken: page } : {}) })
      const d = await this.request(access, "GET", `/tasks/v1/users/@me/lists?${q}`)
      out.push(...(d?.items ?? []))
      page = d?.nextPageToken ?? ""
    } while (page)
    return out
  }

  createList(access, title) {
    return this.request(access, "POST", "/tasks/v1/users/@me/lists", { title })
  }

  async tasks(access, listId) {
    const out = []
    let page = ""
    do {
      const q = new URLSearchParams({
        maxResults: "100",
        showCompleted: "true",
        showHidden: "true",
        showDeleted: "false",
        ...(page ? { pageToken: page } : {}),
      })
      const d = await this.request(
        access,
        "GET",
        `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?${q}`,
      )
      out.push(...(d?.items ?? []))
      page = d?.nextPageToken ?? ""
    } while (page)
    return out
  }

  createTask(access, listId, task) {
    return this.request(access, "POST", `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, task)
  }

  patchTask(access, listId, id, patch) {
    return this.request(
      access,
      "PATCH",
      `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`,
      patch,
    )
  }

  async deleteTask(access, listId, id) {
    try {
      await this.request(
        access,
        "DELETE",
        `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`,
      )
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e
    }
  }
}
