// Токены GitHub хранятся по логину, а не в каждой сессии: refresh-токен GitHub одноразовый,
// и если бы им пользовались несколько сессий (или фоновая синхронизация задач), они бы
// выбивали друг друга. Здесь одна цепочка токенов на логин и одно место, где она обновляется.

export class TokenError extends Error {
  constructor(message) {
    super(message)
    this.status = 401
  }
}

export class TokenKeeper {
  /** store: SecretStore; github: клиент с методом refresh(). */
  constructor({ store, github, now = () => Date.now(), log = console }) {
    this.store = store
    this.github = github
    this.now = now
    this.log = log
    this.inflight = new Map()
  }

  key(login) {
    return `gh:${String(login).toLowerCase()}`
  }

  has(login) {
    return Boolean(this.store.get(this.key(login)))
  }

  set(login, t) {
    this.store.set(this.key(login), {
      token: t.token,
      tokenExp: t.tokenExp ?? null,
      refresh: t.refresh ?? null,
      refreshExp: t.refreshExp ?? null,
    })
  }

  drop(login) {
    this.store.set(this.key(login), null)
  }

  /** Действующий токен; при необходимости обновляет его (одновременные вызовы ждут один запрос). */
  async get(login) {
    const t = this.store.get(this.key(login))
    if (!t) throw new TokenError("Нужно войти через GitHub")
    if (!t.tokenExp || t.tokenExp - 60_000 > this.now()) return t.token
    const k = this.key(login)
    if (!this.inflight.has(k)) {
      this.inflight.set(
        k,
        (async () => {
          if (!t.refresh || (t.refreshExp && t.refreshExp < this.now())) {
            this.drop(login)
            throw new TokenError("Доступ к GitHub истёк, войдите снова")
          }
          try {
            const next = await this.github.refresh(t.refresh)
            this.set(login, next)
            return next.token
          } catch (e) {
            this.log.warn?.(`refresh failed for ${login}: ${e.message}`)
            this.drop(login)
            throw new TokenError("Доступ к GitHub истёк, войдите снова")
          }
        })().finally(() => this.inflight.delete(k)),
      )
    }
    return this.inflight.get(k)
  }
}
