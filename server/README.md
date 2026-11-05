# kb-api — редактирование заметок прямо на сайте

Маленький сервис на Node.js без зависимостей. Он позволяет править базу знаний с сайта, с телефона и компьютера: каждое сохранение превращается в коммит в репозиторий `VLmb/knowledge`, после чего GitHub Actions пересобирает сайт.

```
Браузер ──/api/──► nginx ──► kb-api (127.0.0.1:8787) ──► GitHub API ──► коммит в knowledge
   ▲                                                                     │
   └──────────── сайт пересобирается (GitHub Actions) ◄─────────────────┘
```

## Как устроена безопасность

- **Вход через GitHub App.** Токен даёт доступ только к репозиториям, куда установлено приложение, то есть только к `knowledge`, а не ко всем вашим. Токены живут 8 часов и обновляются сами.
- **Токены не попадают в браузер.** Они хранятся на сервере, на диске зашифрованы (AES-256-GCM). У браузера только случайный идентификатор сессии в cookie `__Host-kb_session` с флагами `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Белый список логинов.** Править может только логин из `ALLOWED_USERS`. Посторонний, даже войдя через GitHub, получит отказ.
- **Защита от CSRF.** Изменяющие запросы принимаются только с вашего домена (`Origin`) и только с заголовком `X-KB-Request`.
- **Проверка путей.** Можно трогать только `.md`-файлы и `attachments/`. Нельзя `.github`, `.obsidian`, `..` и т. п. Загрузки проверяются по содержимому, SVG со скриптами отклоняются.
- **Конфликты.** Сохранение идёт с версией файла (sha). Если заметку успели изменить в Obsidian, редактор покажет конфликт и разницу, а не перезапишет молча.
- **Ограничения.** Сервис слушает только `127.0.0.1`, наружу выходит через nginx. Есть ограничение частоты запросов.

## Установка

### 1. GitHub App

GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**:

| Поле                                                   | Значение                              |
| ------------------------------------------------------ | ------------------------------------- |
| GitHub App name                                        | любое, например `vlmb-kb-editor`      |
| Homepage URL                                           | `https://ваш-домен`                   |
| Callback URL                                           | `https://ваш-домен/api/auth/callback` |
| Expire user authorization tokens                       | ✓ (по умолчанию)                      |
| Request user authorization (OAuth) during installation | не нужно                              |
| Webhook → Active                                       | **снять галочку**                     |
| Repository permissions → **Contents**                  | Read and write                        |
| Repository permissions → **Actions**                   | Read-only (для статуса публикации)    |
| Repository permissions → Metadata                      | Read-only (выставится само)           |
| Where can this GitHub App be installed?                | Only on this account                  |

После создания:

1. Скопируйте **Client ID**.
2. Нажмите **Generate a new client secret** и скопируйте секрет.
3. Слева **Install App** → ваш аккаунт → **Only select repositories** → `knowledge`.

### 2. Сервер

```bash
curl -fsSL https://raw.githubusercontent.com/VLmb/quartz/v5/server/deploy/install.sh -o install.sh
sudo bash install.sh
```

Первый запуск поставит Node.js 22 (если нужно), создаст пользователя `kb-api`, скачает код в `/opt/kb` и создаст `/etc/kb-api.env` со случайным `SESSION_SECRET`. Откройте этот файл и заполните три строки:

```bash
sudo nano /etc/kb-api.env
```

```ini
GITHUB_CLIENT_ID=Iv23li...
GITHUB_CLIENT_SECRET=...
SITE_ORIGIN=https://ваш-домен
```

Запустите скрипт ещё раз, он включит и проверит сервис:

```bash
sudo bash install.sh
```

### 3. nginx

В `deploy/nginx.conf` уже есть блок `location /api/` (прокси на `127.0.0.1:8787`). Перенесите его в конфиг сайта, если ставили nginx раньше, затем:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Проверка: `https://ваш-домен/api/health` → `{"ok":true}`. На сайте внизу боковой панели появится «Войти, чтобы редактировать».

## Обновление

```bash
sudo bash /opt/kb/server/deploy/install.sh
```

## Логи и диагностика

```bash
journalctl -u kb-api -f          # логи
systemctl status kb-api          # состояние
curl -s 127.0.0.1:8787/api/health
```

- **«Нет доступа к репозиторию».** GitHub App не установлена на `knowledge` или у неё нет права Contents: Read and write.
- **После входа «не разрешено».** Логина нет в `ALLOWED_USERS`.
- **Вход возвращает на ошибку.** Проверьте Callback URL в настройках App и `SITE_ORIGIN`: они должны совпадать с адресом сайта, включая `https`.
- **Статус публикации не обновляется.** Выдайте App право Actions: Read-only.

## Разработка и тесты

```bash
cd server
npm test            # 13 сценариев на поддельном GitHub (tests/mock-github.mjs)
```

Код:

- `src/app.mjs` — маршруты API;
- `src/github.mjs` — клиент GitHub;
- `src/sessions.mjs` — зашифрованные сессии;
- `src/paths.mjs` — проверки путей и файлов.

Редактор в браузере лежит в `quartz/console/editor/` и собирается в отдельный файл, который грузится только при открытии редактора.

## API

| Метод  | Путь                         | Что делает                                            |
| ------ | ---------------------------- | ----------------------------------------------------- |
| GET    | `/api/auth/login?next=/путь` | вход через GitHub                                     |
| GET    | `/api/auth/callback`         | возврат от GitHub                                     |
| POST   | `/api/auth/logout`           | выход                                                 |
| GET    | `/api/me`                    | кто вошёл                                             |
| GET    | `/api/file?path=…`           | содержимое заметки и её версия (sha)                  |
| PUT    | `/api/file`                  | сохранить `{path, content, sha?}` (без sha — создать) |
| DELETE | `/api/file`                  | удалить `{path, sha}`                                 |
| POST   | `/api/move`                  | перенести `{from, to}` одним коммитом                 |
| POST   | `/api/upload?name=…`         | загрузить картинку в `attachments/`                   |
| GET    | `/api/tree`                  | папки, заметки и вложения (для подсказок)             |
| GET    | `/api/deploy?sha=…`          | статус сборки сайта для коммита                       |
