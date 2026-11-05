# kb — тема в стиле Linear для Quartz

Форк [Quartz v5](https://github.com/jackyzha0/quartz) для личной базы знаний [VLmb/knowledge](https://github.com/VLmb/knowledge).

Что изменено по сравнению с Quartz:

- `quartz/console/` — тема в стиле Linear: тёмный холст `#08090a`, Inter с `cv01`/`ss03`, тонкие границы вместо теней, лаймовый акцент `#e4f222` только для главного действия. Боковая панель с навигацией и деревом заметок, верхняя полоса с путём, правая панель (свойства, содержание, граф, история правок), поиск-палитра по `Ctrl K`, главная со списком недавних, «Продолжить чтение», закреплёнными и «Повторить сегодня». Шрифты Inter и JetBrains Mono лежат локально и работают офлайн.
- Второе оформление «Консоль» (моноширинный, в духе IDE): переключатель Linear / Консоль внизу боковой панели, выбор запоминается. Стили: `quartz/console/styles/linear.scss` и `console-skin.scss`.
- **Редактирование на сайте:** кнопка «Редактировать» (или клавиша `E`) открывает редактор на CodeMirror с превью, автодополнением `[[ссылок]]` и `#тегов`, вставкой картинок (в том числе с камеры телефона), черновиками и разбором конфликтов с Obsidian. Сохранение — коммит в `knowledge` через бэкенд `server/` (kb-api, вход через GitHub App). Код редактора — `quartz/console/editor/`, установка бэкенда — [`server/README.md`](server/README.md).
- PWA: манифест, иконки (`quartz/static/pwa/`), service worker с офлайн-кешем всех заметок (`quartz/console/sw.template.js.txt`).
- `quartz.ts` — подключение темы; `quartz.config.yaml` — настройки сайта.
- `quartz/components/Head.tsx` — теги PWA.
- `deploy/nginx.conf` — конфиг сервера. Инструкция по деплою — в README репозитория knowledge.

Локальный просмотр с заметками из соседней папки:

```bash
npm ci
npx quartz build -d ../knowledge --serve
```

---

# Quartz v5

> “[One] who works with the door open gets all kinds of interruptions, but [they] also occasionally gets clues as to what the world is and what might be important.” — Richard Hamming

Quartz is a set of tools that helps you publish your [digital garden](https://jzhao.xyz/posts/networked-thought) and notes as a website for free.

🔗 Read the documentation and get started: https://quartz.jzhao.xyz/

[Join the Discord Community](https://discord.gg/cRFFHYye7t)

## Sponsors

<p align="center">
  <a href="https://github.com/sponsors/jackyzha0">
    <img src="https://cdn.jsdelivr.net/gh/jackyzha0/jackyzha0/sponsorkit/sponsors.svg" />
  </a>
</p>
