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

### 4. Закрытый сайт (только для вас)

В `deploy/nginx.conf` весь сайт закрыт через `auth_request`: каждую страницу nginx пропускает, только если kb-api видит cookie сессии (`/api/auth/check`, без обращений к GitHub). Без неё — переадресация на вход через GitHub и обратно на ту же страницу. Открыты без входа только `/api/`, `sw.js`, манифест и иконки (их браузер запрашивает без cookie).

Вход нужен один раз на устройстве: сессия живёт `SESSION_TTL_DAYS` (по умолчанию 365 дней) и продлевается при каждом заходе. Истечение токена GitHub (8 часов) на просмотр не влияет — токен обновляется сам, а если GitHub его отзовёт, попросит войти заново только редактор.

Чтобы снова открыть сайт всем, закомментируйте `auth_request` и `error_page 401` в начале блока `server`.

### 5. Google Tasks (необязательно)

Задачи из заметок синхронизируются с Google Tasks в обе стороны, раз в 5 минут и по кнопке.

1. [console.cloud.google.com](https://console.cloud.google.com) → создайте проект (например, `vlmb-kb`).
2. **APIs & Services → Library → Google Tasks API → Enable.**
3. **Google Auth Platform → Branding:** имя приложения, ваша почта. **Audience:** External, затем **Publish app** (статус _In production_). В статусе _Testing_ Google отзывает доступ каждые 7 дней. Проверка приложения Google не нужна: при подключении будет предупреждение «приложение не проверено» → «Дополнительно» → «Перейти».
4. **Clients → Create client → Web application.** Authorized redirect URI: `https://ваш-домен/api/gtasks/callback`.
5. Client ID и Client secret впишите в `/etc/kb-api.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) и перезапустите: `sudo systemctl restart kb-api`.
6. На сайте: **Настройки → Google Tasks → Подключить.**

Как это работает:

- задачи — чекбоксы во всех заметках папки `Задачи/` (заметка `Задачи/Работа.md` = список «Работа» в Google, создаётся сам) и чекбоксы с тегом `#задача` в любой другой заметке (уходят в первый список Google или в `GTASKS_DEFAULT_LIST`);
- срок и дата выполнения — как в плагине Obsidian Tasks: `- [ ] Купить молоко 📅 2026-11-10`, `- [x] Отчёт ✅ 2026-11-07`;
- связь со строкой — комментарий `%%gt:id%%` в конце (в режиме чтения и на сайте не виден, не удаляйте его);
- новые задачи из Google (невыполненные) дописываются в `Задачи/<Список>.md`;
- поменяли в одном месте — меняется в другом; поменяли одно и то же поле в обоих — побеждает Obsidian;
- удалили в одном месте — удаляется в другом (если с прошлой синхронизации задачу не правили);
- все правки заметок за проход — один коммит «Задачи: синхронизация с Google Tasks», Obsidian подтянет его при следующей синхронизации;
- ограничения Google: время у срока не сохраняется (только дата), повторы и напоминания через API недоступны.

Токены Google и GitHub хранятся на сервере зашифрованными (`/var/lib/kb-api/*.enc`).

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
| GET    | `/api/auth/check`            | 204/401 — для nginx `auth_request`                    |
| GET    | `/api/gtasks/status`         | состояние синхронизации задач                         |
| GET    | `/api/gtasks/connect`        | подключить Google Tasks (OAuth)                       |
| POST   | `/api/gtasks/sync`           | синхронизировать сейчас                               |
| POST   | `/api/gtasks/disconnect`     | отключить                                             |
| GET    | `/api/gtasks/board`          | списки и задачи из Google + порядок/скрытые списки    |
| POST   | `/api/gtasks/task`           | новая задача `{listId, title, due?, previous?}`       |
| PATCH  | `/api/gtasks/task`           | правка `{listId, id, title?, notes?, due?, done?}`    |
| DELETE | `/api/gtasks/task`           | удалить `{listId, id}`                                |
| POST   | `/api/gtasks/move`           | перестановка `{listId, id, previous?, toListId?}`     |
| PUT    | `/api/gtasks/prefs`          | порядок, свёрнутые и скрытые списки                   |
| GET    | `/api/inbox`                 | мысли из `Inbox.md`                                   |
| POST   | `/api/inbox`                 | новая мысль `{text, at?}` (сверху списка)             |
| PUT    | `/api/inbox`                 | дописать `{id, text}`                                 |
| DELETE | `/api/inbox`                 | удалить `{id}`                                        |
