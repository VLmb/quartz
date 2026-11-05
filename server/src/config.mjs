// Настройки kb-api берутся из переменных окружения (файл /etc/kb-api.env на сервере).

export function loadConfig(env = process.env) {
  const need = (key) => {
    const v = env[key]
    if (!v) throw new Error(`Не задана переменная окружения ${key}`)
    return v
  }
  const cfg = {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8787),
    clientId: need("GITHUB_CLIENT_ID"),
    clientSecret: need("GITHUB_CLIENT_SECRET"),
    siteOrigin: need("SITE_ORIGIN").replace(/\/+$/, ""),
    repo: env.REPO ?? "VLmb/knowledge",
    branch: env.BRANCH ?? "main",
    allowedUsers: (env.ALLOWED_USERS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    sessionSecret: need("SESSION_SECRET"),
    dataDir: env.DATA_DIR ?? "./data",
    githubApi: (env.GITHUB_API ?? "https://api.github.com").replace(/\/+$/, ""),
    githubWeb: (env.GITHUB_WEB ?? "https://github.com").replace(/\/+$/, ""),
    secureCookies: (env.COOKIE_SECURE ?? "true") !== "false",
    sessionTtlMs: Number(env.SESSION_TTL_DAYS ?? 30) * 24 * 3600 * 1000,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,
    trustProxy: (env.TRUST_PROXY ?? "true") !== "false",
  }
  if (cfg.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET должен быть не короче 32 символов (openssl rand -hex 32)")
  }
  if (cfg.allowedUsers.length === 0) {
    throw new Error("ALLOWED_USERS пуст: укажите логины GitHub, которым можно редактировать")
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) throw new Error("REPO должен быть вида owner/name")
  return cfg
}
