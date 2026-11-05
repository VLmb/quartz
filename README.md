# kb — тема «Консоль» для Quartz

Форк [Quartz v5](https://github.com/jackyzha0/quartz) для личной базы знаний [VLmb/knowledge](https://github.com/VLmb/knowledge).

Что изменено по сравнению с Quartz:

- `quartz/console/` — тема «Консоль»: свой каркас страницы (шапка, панель активности, проводник, вкладки, правая панель со структурой, графом и историей правок, статусбар, мобильные вкладки), поиск-палитра по `Ctrl K`, главная с недавними, закреплёнными и «Повторить сегодня», офлайн-шрифты JetBrains Mono и Onest.
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
