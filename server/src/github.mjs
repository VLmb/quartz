// Тонкий клиент GitHub REST API: только то, что нужно редактору.

export class GitHubError extends Error {
  constructor(status, message, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

const enc = (p) => p.split("/").map(encodeURIComponent).join("/")

export class GitHub {
  constructor(cfg, fetchImpl = fetch) {
    this.cfg = cfg
    this.fetch = fetchImpl
    this.repoPath = `/repos/${cfg.repo}`
  }

  async request(token, method, path, body, { accept } = {}) {
    const res = await this.fetch(this.cfg.githubApi + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "kb-api",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data = text
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      try {
        data = JSON.parse(text)
      } catch {}
    }
    if (!res.ok) {
      throw new GitHubError(res.status, data?.message ?? `GitHub ответил ${res.status}`, data)
    }
    return data
  }

  /* ───── OAuth (GitHub App, user-to-server токены) ───── */

  redirectUri() {
    return `${this.cfg.siteOrigin}/api/auth/callback`
  }

  authorizeUrl(state) {
    const u = new URL(`${this.cfg.githubWeb}/login/oauth/authorize`)
    u.searchParams.set("client_id", this.cfg.clientId)
    u.searchParams.set("redirect_uri", this.redirectUri())
    u.searchParams.set("state", state)
    u.searchParams.set("allow_signup", "false")
    return u.toString()
  }

  async tokenRequest(params) {
    const res = await this.fetch(`${this.cfg.githubWeb}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "kb-api",
      },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        ...params,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error || !data.access_token) {
      throw new GitHubError(
        401,
        data.error_description ?? data.error ?? "Не удалось получить токен",
      )
    }
    const now = Date.now()
    return {
      token: data.access_token,
      tokenExp: data.expires_in ? now + data.expires_in * 1000 : null,
      refresh: data.refresh_token ?? null,
      refreshExp: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : null,
    }
  }

  exchangeCode(code) {
    return this.tokenRequest({ code, redirect_uri: this.redirectUri() })
  }

  refresh(refreshToken) {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken })
  }

  getUser(token) {
    return this.request(token, "GET", "/user")
  }

  /* ───── файлы ───── */

  async getFile(token, path) {
    let data
    try {
      data = await this.request(
        token,
        "GET",
        `${this.repoPath}/contents/${enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`,
      )
    } catch (e) {
      if (e.status === 404) return null
      throw e
    }
    if (Array.isArray(data) || data.type !== "file") {
      throw new GitHubError(400, "Это папка, а не файл")
    }
    let content
    if (data.encoding === "base64" && data.content) {
      content = Buffer.from(data.content, "base64").toString("utf8")
    } else {
      content = await this.request(
        token,
        "GET",
        `${this.repoPath}/contents/${enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`,
        undefined,
        { accept: "application/vnd.github.raw+json" },
      )
    }
    return { path, sha: data.sha, content: String(content), htmlUrl: data.html_url }
  }

  async exists(token, path) {
    try {
      await this.request(
        token,
        "GET",
        `${this.repoPath}/contents/${enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`,
      )
      return true
    } catch (e) {
      if (e.status === 404) return false
      throw e
    }
  }

  async putFile(token, path, base64, sha, message) {
    const data = await this.request(token, "PUT", `${this.repoPath}/contents/${enc(path)}`, {
      message,
      content: base64,
      branch: this.cfg.branch,
      ...(sha ? { sha } : {}),
    })
    return { sha: data.content.sha, commit: data.commit.sha }
  }

  async deleteFile(token, path, sha, message) {
    const data = await this.request(token, "DELETE", `${this.repoPath}/contents/${enc(path)}`, {
      message,
      sha,
      branch: this.cfg.branch,
    })
    return { commit: data.commit.sha }
  }

  async tree(token) {
    const data = await this.request(
      token,
      "GET",
      `${this.repoPath}/git/trees/${encodeURIComponent(this.cfg.branch)}?recursive=1`,
    )
    return data.tree ?? []
  }

  /** Перенос файла одним коммитом через Git Data API (история не теряется). */
  async move(token, from, to, message) {
    const b = encodeURIComponent(this.cfg.branch)
    const ref = await this.request(token, "GET", `${this.repoPath}/git/ref/heads/${b}`)
    const head = ref.object.sha
    const commit = await this.request(token, "GET", `${this.repoPath}/git/commits/${head}`)
    const file = await this.request(
      token,
      "GET",
      `${this.repoPath}/contents/${enc(from)}?ref=${head}`,
    )
    const tree = await this.request(token, "POST", `${this.repoPath}/git/trees`, {
      base_tree: commit.tree.sha,
      tree: [
        { path: to, mode: "100644", type: "blob", sha: file.sha },
        { path: from, mode: "100644", type: "blob", sha: null },
      ],
    })
    const next = await this.request(token, "POST", `${this.repoPath}/git/commits`, {
      message,
      tree: tree.sha,
      parents: [head],
    })
    await this.request(token, "PATCH", `${this.repoPath}/git/refs/heads/${b}`, {
      sha: next.sha,
      force: false,
    })
    return { sha: file.sha, commit: next.sha }
  }

  /* ───── снимок репозитория и пакетный коммит (для синхронизации задач) ───── */

  async headSha(token) {
    const b = encodeURIComponent(this.cfg.branch)
    const ref = await this.request(token, "GET", `${this.repoPath}/git/ref/heads/${b}`)
    return ref.object.sha
  }

  async treeAt(token, sha) {
    const data = await this.request(
      token,
      "GET",
      `${this.repoPath}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
    )
    return data.tree ?? []
  }

  async blob(token, sha) {
    const data = await this.request(
      token,
      "GET",
      `${this.repoPath}/git/blobs/${encodeURIComponent(sha)}`,
    )
    return Buffer.from(data.content ?? "", data.encoding === "base64" ? "base64" : "utf8").toString(
      "utf8",
    )
  }

  /**
   * Один коммит с несколькими файлами поверх head. Если ветка ушла вперёд —
   * GitHub ответит 422, и вызывающий повторит попытку с нового снимка.
   * changes: [{ path, content }] (content === null — удалить файл).
   */
  async commitChanges(token, head, changes, message) {
    const b = encodeURIComponent(this.cfg.branch)
    const commit = await this.request(token, "GET", `${this.repoPath}/git/commits/${head}`)
    const tree = await this.request(token, "POST", `${this.repoPath}/git/trees`, {
      base_tree: commit.tree.sha,
      tree: changes.map((c) =>
        c.content === null
          ? { path: c.path, mode: "100644", type: "blob", sha: null }
          : { path: c.path, mode: "100644", type: "blob", content: c.content },
      ),
    })
    const next = await this.request(token, "POST", `${this.repoPath}/git/commits`, {
      message,
      tree: tree.sha,
      parents: [head],
    })
    await this.request(token, "PATCH", `${this.repoPath}/git/refs/heads/${b}`, {
      sha: next.sha,
      force: false,
    })
    return next.sha
  }

  async deployStatus(token, sha) {
    const data = await this.request(
      token,
      "GET",
      `${this.repoPath}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=5`,
    )
    const run = (data.workflow_runs ?? [])[0]
    if (!run) return { status: "pending", conclusion: null, url: null }
    return { status: run.status, conclusion: run.conclusion, url: run.html_url }
  }
}
