import { QuartzComponentProps } from "../components/types"
import { QuartzPluginData } from "../plugins/vfile"
import { Icon } from "./icons"
import { FullSlug, pathToRoot } from "../util/path"
import { INBOX_SLUG, TASKS_SLUG, spaceOfSlug } from "./data"
import {
  backlinksOf,
  desc,
  folderHref,
  folderNames,
  folderOf,
  href,
  isPinned,
  isoDay,
  modifiedTs,
  notes,
  pageKind,
  pathSegments,
  readingMinutes,
  shortDate,
  tagHref,
  tags,
  title,
  topFolders,
  wordCount,
} from "./data"

type P = QuartzComponentProps

/** Время, которое скрипт на клиенте превращает в «12 мин назад». */
function Ago({ ts, prefix }: { ts: number; prefix?: string }) {
  return (
    <time data-ago={ts} data-prefix={prefix ?? ""} datetime={ts ? new Date(ts).toISOString() : ""}>
      {prefix}
      {shortDate(ts)}
    </time>
  )
}

function lastUpdate(allFiles: QuartzPluginData[]): number {
  return Math.max(0, ...notes(allFiles).map(modifiedTs))
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function Tags({ f, from }: { f: QuartzPluginData; from?: string }) {
  const t = tags(f)
  if (t.length === 0) return null
  return (
    <span class="pills">
      {t.map((tag) =>
        from !== undefined ? (
          <a class="pill" href={tagHref(from, tag)}>
            {tag}
          </a>
        ) : (
          <span class="pill">{tag}</span>
        ),
      )}
    </span>
  )
}

/* ───────────── логотип ───────────── */

export function Logo({ from }: { from: string | undefined }) {
  const root = pathToRoot((from ?? "index") as FullSlug)
  return <img src={`${root}/static/logo.png`} alt="" width={22} height={22} decoding="async" />
}

/* ───────────── верхняя панель (над контентом) ───────────── */

export function Topbar(props: P) {
  // видна только в оформлении Linear
  const { fileData, cfg } = props
  return (
    <>
      <button type="button" class="icon-btn m-only" data-drawer aria-label="Меню">
        <Icon name="menu" />
      </button>
      <Crumbs {...props} />
      <div class="tb-right">
        <span class="offline-badge" title="Нет сети — показываю сохранённую копию">
          <Icon name="offline" />
          офлайн
        </span>
        <button type="button" class="icon-btn m-only" data-search aria-label="Поиск">
          <Icon name="search" />
        </button>
        {pageKind(fileData.slug) === "note" && (
          <button
            type="button"
            class="edit-btn d-only kb-auth-only"
            data-edit
            title="Редактировать (E)"
          >
            <Icon name="pencil" />
            Редактировать
          </button>
        )}
        {pageKind(fileData.slug) === "note" && (
          <>
            <button
              type="button"
              class="icon-btn"
              data-share
              title="Поделиться ссылкой"
              aria-label="Поделиться"
            >
              <Icon name="share" />
            </button>
            <button
              type="button"
              class="icon-btn d-only panel-toggle"
              data-panel-toggle
              title="Правая панель ( ] )"
              aria-label="Показать или скрыть правую панель"
            >
              <Icon name="panelRight" />
            </button>
          </>
        )}
        <a class="m-only tb-home" href={href(fileData.slug, "index")} aria-label={cfg.pageTitle}>
          <span class="mark logo">
            <Logo from={fileData.slug} />
          </span>
        </a>
      </div>
      <span class="tb-progress" data-progress></span>
    </>
  )
}

export function Crumbs({ fileData, allFiles }: P) {
  const slug = fileData.slug ?? "index"
  const kind = pageKind(slug)
  const names = folderNames(allFiles)
  const parts = slug.split("/")
  const dirSlugs =
    kind === "folder" ? parts.slice(0, -2) : kind === "note" ? parts.slice(0, -1) : []
  const crumbs = dirSlugs.map((_, i) => dirSlugs.slice(0, i + 1).join("/"))
  const last =
    kind === "home"
      ? "Главная"
      : kind === "tag" && slug !== "tags/index"
        ? `#${title(fileData)}`
        : title(fileData)
  return (
    <nav class="crumbs" aria-label="Путь">
      {kind === "tag" && slug !== "tags/index" && (
        <>
          <a href={href(slug, "tags/index")}>Теги</a>
          <Icon name="chev" cls="sep" />
        </>
      )}
      {crumbs.map((c) => (
        <>
          <a href={folderHref(slug, c)}>{names.get(c) ?? c}</a>
          <Icon name="chev" cls="sep" />
        </>
      ))}
      <b>{last}</b>
    </nav>
  )
}

/* ───────────── вход для редактирования ───────────── */

export function Account() {
  return (
    <div class="account">
      <button type="button" class="acc-login kb-anon-only" data-login>
        <Icon name="login" />
        Войти, чтобы редактировать
      </button>
      <div class="acc-user kb-auth-only">
        <img class="acc-ava" data-account-avatar alt="" width="20" height="20" />
        <span class="acc-name" data-account-login></span>
        <button type="button" class="icon-btn sm" data-logout title="Выйти" aria-label="Выйти">
          <Icon name="logout" />
        </button>
      </div>
    </div>
  )
}

/** Плавающая кнопка на телефоне: на заметке — править, на остальных страницах — создать. */
export function EditFab({ fileData }: P) {
  const isNote = pageKind(fileData.slug) === "note"
  return isNote ? (
    <button type="button" class="kb-fab kb-auth-only" data-edit aria-label="Редактировать">
      <Icon name="pencil" />
    </button>
  ) : (
    <button type="button" class="kb-fab kb-auth-only" data-new-note aria-label="Новая заметка">
      <Icon name="plus" />
    </button>
  )
}

/* ───────────── боковая панель ───────────── */

type TreeNode = {
  name: string
  slug: string
  dirs: Map<string, TreeNode>
  files: QuartzPluginData[]
}

function buildTree(allFiles: QuartzPluginData[]): TreeNode {
  const root: TreeNode = { name: "", slug: "", dirs: new Map(), files: [] }
  for (const f of notes(allFiles)) {
    const segs = pathSegments(f)
    const slugSegs = (f.slug ?? "").split("/")
    let node = root
    for (let i = 0; i < segs.length - 1; i++) {
      const key = slugSegs[i]
      if (!node.dirs.has(key)) {
        node.dirs.set(key, {
          name: segs[i],
          slug: slugSegs.slice(0, i + 1).join("/"),
          dirs: new Map(),
          files: [],
        })
      }
      node = node.dirs.get(key)!
    }
    node.files.push(f)
  }
  return root
}

function countFiles(n: TreeNode): number {
  let c = n.files.length
  for (const d of n.dirs.values()) c += countFiles(d)
  return c
}

function TreeLevel({ node, current }: { node: TreeNode; current: string }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
  const files = [...node.files].sort((a, b) => title(a).localeCompare(title(b), "ru"))
  return (
    <>
      {dirs.map((d) => {
        const open = current.startsWith(d.slug + "/")
        return (
          <li class={open ? "open" : ""} data-dir={d.slug}>
            <button type="button" class="f-dir">
              <Icon name="chev" cls="chev" />
              <span class="f-name">{d.name}</span>
              <span class="f-n">{countFiles(d)}</span>
            </button>
            <ul>
              <TreeLevel node={d} current={current} />
            </ul>
          </li>
        )
      })}
      {files.map((f) => (
        <li>
          <a
            href={href(current, f.slug!)}
            class={`f-file ${f.slug === current ? "on" : ""}`}
            data-slug={f.slug}
          >
            {title(f)}
          </a>
        </li>
      ))}
    </>
  )
}

export function Sidebar({ fileData, allFiles, cfg }: P) {
  const tree = buildTree(allFiles)
  const current = fileData.slug ?? "index"
  const kind = pageKind(current)
  const space = spaceOfSlug(current)
  const total = countFiles(tree)
  return (
    <aside class="side" data-explorer>
      <div class="sb-top">
        <a class="ws" href={href(current, "index")}>
          <span class="mark logo">
            <Logo from={fileData.slug} />
          </span>
          <b>{cfg.pageTitle}</b>
        </a>
        <button type="button" class="icon-btn tt" data-theme-toggle aria-label="Сменить тему">
          <Icon name="sun" cls="i-sun" />
          <Icon name="moon" cls="i-moon" />
        </button>
      </div>
      <button type="button" class="sb-search" data-search>
        <Icon name="search" />
        <span>Поиск</span>
        <kbd>Ctrl K</kbd>
      </button>
      <nav class="sb-nav">
        <a href={href(current, "index")} class={`nav-i ${kind === "home" ? "on" : ""}`}>
          <Icon name="home" />
          Главная
        </a>
        <a
          href={href(current, TASKS_SLUG)}
          class={`nav-i ${space === "tasks" ? "on" : ""}`}
          data-nav-space="tasks"
        >
          <Icon name="tasks" />
          Задачи
        </a>
        <a href={href(current, INBOX_SLUG)} class={`nav-i ${space === "inbox" ? "on" : ""}`}>
          <Icon name="inbox" />
          Inbox
        </a>
        <a href={href(current, "tags/index")} class={`nav-i ${kind === "tag" ? "on" : ""}`}>
          <Icon name="hash" />
          Теги
        </a>
      </nav>
      <div class="pane-h">
        <span>Хранилище</span>
        <span class="pane-n">{total}</span>
        <button
          type="button"
          class="icon-btn sm kb-auth-only"
          data-new-note
          title="Новая заметка"
          aria-label="Новая заметка"
        >
          <Icon name="plus" />
        </button>
      </div>
      <ul class="tree">
        <TreeLevel node={tree} current={current} />
        {total === 0 && <li class="tree-empty">Пока пусто</li>}
      </ul>
      <div class="sb-foot">
        <Account />
        <button type="button" class="sb-settings" data-settings title="Настройки ( , )">
          <Icon name="sliders" />
          Настройки
        </button>
      </div>
    </aside>
  )
}

/* ───────────── заметка ───────────── */

export function NoteMeta({ fileData }: P) {
  const folder = folderOf(fileData)
  const slug = fileData.slug ?? ""
  const folderSlug = slug.split("/").slice(0, -1).join("/")
  return (
    <div class="n-meta skin-l">
      {folder && (
        <a class="badge" href={folderHref(slug, folderSlug)}>
          <Icon name="folder" />
          {folder}
        </a>
      )}
      <Tags f={fileData} from={slug} />
      <span class="meta-t">
        <Ago ts={modifiedTs(fileData)} />
      </span>
      <span class="meta-t">{readingMinutes(fileData)} мин</span>
    </div>
  )
}

export function Properties({ fileData }: P) {
  // только в оформлении Linear
  const slug = fileData.slug ?? ""
  const created = fileData.dates?.created ? new Date(fileData.dates.created).getTime() : 0
  const modified = modifiedTs(fileData)
  const words = wordCount(fileData)
  return (
    <section class="pane skin-l">
      <div class="pane-h">
        <span>Свойства</span>
      </div>
      <dl class="props">
        {tags(fileData).length > 0 && (
          <>
            <dt>Теги</dt>
            <dd>
              <Tags f={fileData} from={slug} />
            </dd>
          </>
        )}
        {modified > 0 && (
          <>
            <dt>Изменено</dt>
            <dd>
              <Ago ts={modified} />
            </dd>
          </>
        )}
        {created > 0 && (
          <>
            <dt>Создано</dt>
            <dd class="mono">{isoDay(created)}</dd>
          </>
        )}
        <dt>Объём</dt>
        <dd>
          {words} {plural(words, "слово", "слова", "слов")} · {readingMinutes(fileData)} мин
        </dd>
      </dl>
    </section>
  )
}

export function Toc({ fileData }: P) {
  const toc = (fileData.toc ?? []).filter((t) => t.depth <= 2)
  if (toc.length === 0) return null
  return (
    <nav class="toc" data-toc>
      <span class="toc-indicator"></span>
      {toc.map((t) => (
        <a class={`toc-link toc-h${t.depth + 1}`} href={`#${t.slug}`} data-for={t.slug}>
          {t.text}
        </a>
      ))}
    </nav>
  )
}

export function MobileToc(props: P) {
  if ((props.fileData.toc ?? []).length === 0) return null
  return (
    <details class="mobile-toc">
      <summary>
        <Icon name="list" />
        Содержание
        <Icon name="chevDown" cls="mt-ic" />
      </summary>
      <Toc {...props} />
    </details>
  )
}

export function History({ fileData }: P) {
  const hist = fileData.gitHistory ?? []
  if (hist.length === 0) return null
  return (
    <section class="pane">
      <div class="pane-h">
        <span>История</span>
      </div>
      <ol class="hist">
        {hist.map((c) => (
          <li>
            <span class="hash">{c.hash}</span>
            <span class="h-msg">{c.msg}</span>
            <span class="h-when">
              <Ago ts={c.ts} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function Backlinks({ fileData, allFiles }: P) {
  const bl = backlinksOf(allFiles, fileData.slug ?? "")
  if (bl.length === 0) return null
  return (
    <section class="n-end">
      <h2 class="sec-t">
        Ссылаются сюда <span class="count">{bl.length}</span>
      </h2>
      <div class="rows">
        {bl.map((f) => (
          <a class="row" href={href(fileData.slug, f.slug!)}>
            <Icon name="file" cls="row-ic" />
            <span class="row-t">{title(f)}</span>
            <span class="row-x">{desc(f)}</span>
            <span class="badge">{folderOf(f) ?? "/"}</span>
          </a>
        ))}
      </div>
    </section>
  )
}

/* ───────────── главная ───────────── */

function NoteRow({ f, from, i }: { f: QuartzPluginData; from: string; i: number }) {
  return (
    <a class="row card" href={href(from, f.slug!)} data-key={i + 1} data-slug={f.slug}>
      <Icon name="file" cls="row-ic" />
      <span class="row-t">{title(f)}</span>
      <span class="row-x">{desc(f)}</span>
      <Tags f={f} />
      <span class="badge">{folderOf(f) ?? "/"}</span>
      <span class="row-when">
        <Ago ts={modifiedTs(f)} />
      </span>
      {i < 8 && <kbd class="row-k">{i + 1}</kbd>}
    </a>
  )
}

export function Home({ fileData, allFiles }: P) {
  const from = fileData.slug ?? "index"
  const all = notes(allFiles)
  const recent = [...all].sort((a, b) => modifiedTs(b) - modifiedTs(a)).slice(0, 8)
  const pinned = all.filter(isPinned).sort((a, b) => title(a).localeCompare(title(b), "ru"))
  const folders = topFolders(allFiles)
  return (
    <div class="home-wrap">
      <header class="hero">
        <h1 class="display skin-l">База знаний</h1>
        <p class="lede skin-l">
          {all.length} {plural(all.length, "заметка", "заметки", "заметок")} в {folders.length}{" "}
          {plural(folders.length, "разделе", "разделах", "разделах")} ·{" "}
          <Ago ts={lastUpdate(allFiles)} prefix="обновлено " />
        </p>
        <button class="big-search" data-search type="button">
          <Icon name="search" />
          <span>Найти заметку, тег или раздел</span>
          <kbd>Ctrl K</kbd>
        </button>
        {folders.length > 0 && (
          <div class="chips">
            {folders.map((d) => (
              <a href={folderHref(from, d.slug)} class="pill">
                {d.name}
                <span>{d.count}</span>
              </a>
            ))}
          </div>
        )}
      </header>

      <div class="continue" data-continue hidden></div>

      <section class="sec">
        <div class="sec-h">
          <h2 class="sec-t">Недавние</h2>
          <div class="seg" data-seg>
            <button type="button" class="on" data-mode="modified">
              Изменённые
            </button>
            <button type="button" data-mode="opened">
              Открытые
            </button>
          </div>
          <span class="sec-sp"></span>
          <span class="kh">
            <kbd>1</kbd>–<kbd>8</kbd>
          </span>
          <div class="seg seg-ic" data-vt>
            <button type="button" class="on" data-mode="list" aria-label="Список">
              <Icon name="list" />
            </button>
            <button type="button" data-mode="grid" aria-label="Карточки">
              <Icon name="grid" />
            </button>
          </div>
        </div>
        <div class="cards rows" data-cards>
          {recent.map((f, i) => (
            <NoteRow f={f} from={from} i={i} />
          ))}
          {recent.length === 0 && <p class="empty">Пока нет заметок — создай первую в Obsidian.</p>}
        </div>
        <div class="cards rows" data-cards-opened hidden></div>
      </section>

      <div>
        <section class="sec">
          <div class="sec-h">
            <h2 class="sec-t">Закреплённые</h2>
            <span class="count">{pinned.length}</span>
          </div>
          {pinned.length > 0 ? (
            <div class="rows">
              {pinned.map((f) => (
                <a class="row" href={href(from, f.slug!)}>
                  <Icon name="star" cls="row-ic" />
                  <span class="row-t">{title(f)}</span>
                  <span class="badge">{folderOf(f) ?? "/"}</span>
                </a>
              ))}
            </div>
          ) : (
            <p class="empty">
              Добавь <code>pinned: true</code> во frontmatter заметки.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

/* ───────────── оформление «Консоль» (показывается только в нём) ───────────── */

export function CTitlebar({ fileData, allFiles, cfg }: P) {
  return (
    <>
      <a class="tb-logo" href={href(fileData.slug, "index")}>
        <span class="tb-mark logo">
          <Logo from={fileData.slug} />
        </span>
        <b>{cfg.pageTitle}</b>
        <span class="tb-path">~/knowledge</span>
      </a>
      <button class="cmd" data-search type="button">
        <Icon name="search" />
        <span>Найти заметку или тег</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div class="tb-right">
        <span class="sync" title="Последнее изменение в базе">
          <i></i>
          <Ago ts={lastUpdate(allFiles)} prefix="обновлено " />
        </span>
        <span class="offline-badge" title="Нет сети — показываю сохранённую копию">
          <Icon name="offline" />
          офлайн
        </span>
        {pageKind(fileData.slug) === "note" && (
          <button
            class="tb-btn kb-auth-only"
            data-edit
            type="button"
            title="Редактировать (E)"
            aria-label="Редактировать"
          >
            <Icon name="pencil" />
          </button>
        )}
        <button
          class="tb-btn kb-auth-only"
          data-new-note
          type="button"
          title="Новая заметка"
          aria-label="Новая заметка"
        >
          <Icon name="plus" />
        </button>
        {pageKind(fileData.slug) === "note" && (
          <>
            <button
              class="tb-btn"
              data-share
              type="button"
              title="Поделиться ссылкой"
              aria-label="Поделиться"
            >
              <Icon name="share" />
            </button>
            <button
              class="tb-btn panel-toggle"
              data-panel-toggle
              type="button"
              title="Правая панель ( ] )"
              aria-label="Показать или скрыть правую панель"
            >
              <Icon name="panelRight" />
            </button>
          </>
        )}
        <button
          class="tb-btn"
          data-settings
          type="button"
          title="Настройки ( , )"
          aria-label="Настройки"
        >
          <Icon name="sliders" />
        </button>
        <button class="tb-btn tt" data-theme-toggle type="button" aria-label="Сменить тему">
          <Icon name="sun" cls="i-sun" />
          <Icon name="moon" cls="i-moon" />
        </button>
      </div>
      <span class="tb-progress" data-progress></span>
    </>
  )
}

/* ───────────── панель активности ───────────── */

export function CActbar({ fileData }: P) {
  const kind = pageKind(fileData.slug)
  return (
    <nav class="actbar skin-c">
      <a
        href={href(fileData.slug, "index")}
        class={`act ${kind !== "tag" ? "on" : ""}`}
        title="Файлы"
      >
        <Icon name="file" />
      </a>
      <button type="button" data-search class="act" title="Поиск (Ctrl K)">
        <Icon name="search" />
      </button>
      <a
        href={href(fileData.slug, TASKS_SLUG)}
        class={`act ${spaceOfSlug(fileData.slug) === "tasks" ? "on" : ""}`}
        title="Задачи"
      >
        <Icon name="tasks" />
      </a>
      <a
        href={href(fileData.slug, INBOX_SLUG)}
        class={`act ${spaceOfSlug(fileData.slug) === "inbox" ? "on" : ""}`}
        title="Inbox (I — записать мысль)"
      >
        <Icon name="inbox" />
      </a>
      <a
        href={href(fileData.slug, "tags/index")}
        class={`act ${kind === "tag" ? "on" : ""}`}
        title="Теги"
      >
        <Icon name="tag" />
      </a>
    </nav>
  )
}

/* ───────────── вкладки ───────────── */

export function CTabs({ fileData }: P) {
  const kind = pageKind(fileData.slug)
  const label =
    kind === "note"
      ? `${title(fileData)}.md`
      : kind === "folder"
        ? `${title(fileData)}/`
        : kind === "tag"
          ? `#${title(fileData)}`
          : null
  return (
    <div class="tabs skin-c">
      <a href={href(fileData.slug, "index")} class={`tab ${kind === "home" ? "on" : ""}`}>
        <Icon name="home" />
        Главная
      </a>
      {label && (
        <span class="tab on">
          <Icon name={kind === "folder" ? "folder" : kind === "tag" ? "tag" : "file"} />
          <span class="tab-t">{label}</span>
          <a class="x" href={href(fileData.slug, "index")} aria-label="Закрыть">
            <Icon name="x" />
          </a>
        </span>
      )}
    </div>
  )
}

/* ───────────── шапка заметки ───────────── */

export function CCrumbs({ fileData, allFiles, cfg }: P) {
  const slug = fileData.slug ?? ""
  const kind = pageKind(slug)
  const names = folderNames(allFiles)
  const parts = slug.split("/")
  const dirSlugs =
    kind === "folder" ? parts.slice(0, -2) : kind === "note" ? parts.slice(0, -1) : []
  const crumbs = dirSlugs.map((_, i) => dirSlugs.slice(0, i + 1).join("/"))
  const last =
    kind === "note"
      ? `${title(fileData)}.md`
      : kind === "folder"
        ? `${title(fileData)}/`
        : title(fileData)
  return (
    <nav class="v-crumbs skin-c">
      <a href={href(slug, "index")}>{cfg.pageTitle}</a>
      {kind === "tag" && (
        <>
          <span>/</span>
          <a href={href(slug, "tags/index")}>теги</a>
        </>
      )}
      {crumbs.map((c) => (
        <>
          <span>/</span>
          <a href={folderHref(slug, c)}>{names.get(c) ?? c}</a>
        </>
      ))}
      {slug !== "tags/index" && (
        <>
          <span>/</span>
          <b>{last}</b>
        </>
      )}
    </nav>
  )
}

export function CFrontmatter({ fileData }: P) {
  const t = tags(fileData)
  const created = fileData.dates?.created ? new Date(fileData.dates.created).getTime() : 0
  const modified = modifiedTs(fileData)
  return (
    <pre class="fm skin-c">
      <span class="fm-d">---</span>
      {"\n"}
      {t.length > 0 && (
        <>
          <span class="fm-k">tags:</span> [
          {t.map((tag, i) => (
            <>
              {i > 0 && ", "}
              <a class="fm-tag" href={tagHref(fileData.slug, tag)}>
                {tag}
              </a>
            </>
          ))}
          ]{"\n"}
        </>
      )}
      {created > 0 && (
        <>
          <span class="fm-k">created:</span> <span class="fm-n">{isoDay(created)}</span>
          {"\n"}
        </>
      )}
      {modified > 0 && (
        <>
          <span class="fm-k">updated:</span> <Ago ts={modified} />
          {"\n"}
        </>
      )}
      <span class="fm-d">---</span>
    </pre>
  )
}

export function CStatusbar({ fileData, allFiles }: P) {
  const kind = pageKind(fileData.slug)
  return (
    <footer class="statusbar skin-c">
      <span class="sb-item">
        <Icon name="branch" />
        main
      </span>
      <span class="sb-item">
        <Icon name="sync" />
        <Ago ts={lastUpdate(allFiles)} />
      </span>
      <span class="sb-item">{notes(allFiles).length} заметок</span>
      <span class="sb-sp"></span>
      {kind === "note" && (
        <>
          <span class="sb-item">{wordCount(fileData)} слов</span>
          <span class="sb-item">{readingMinutes(fileData)} мин чтения</span>
        </>
      )}
      <button class="sb-item kb-anon-only" type="button" data-login>
        <Icon name="login" />
        войти
      </button>
      <button class="sb-item kb-auth-only" type="button" data-logout title="Выйти">
        <Icon name="logout" />
        <span data-account-login></span>
      </button>
      <button class="sb-item" type="button" data-settings title="Настройки ( , )">
        <Icon name="sliders" />
        настройки
      </button>
      <button class="sb-item" type="button" data-theme-toggle>
        <span class="sb-theme"></span>
      </button>
    </footer>
  )
}

/* ───────────── мобильные вкладки и палитра ───────────── */

export function MobileTabs({ fileData }: P) {
  const kind = pageKind(fileData.slug)
  const space = spaceOfSlug(fileData.slug)
  return (
    <nav class="m-tabs">
      <a href={href(fileData.slug, "index")} class={`mt ${kind === "home" && !space ? "on" : ""}`}>
        <Icon name="home" />
        <span>Главная</span>
      </a>
      <a href={href(fileData.slug, TASKS_SLUG)} class={`mt ${space === "tasks" ? "on" : ""}`}>
        <Icon name="tasks" />
        <span>Задачи</span>
      </a>
      <button type="button" class="mt mt-plus kb-api-only" data-capture aria-label="Записать мысль">
        <Icon name="plus" />
      </button>
      <a href={href(fileData.slug, INBOX_SLUG)} class={`mt ${space === "inbox" ? "on" : ""}`}>
        <Icon name="inbox" />
        <span>Inbox</span>
      </a>
      <button type="button" data-drawer class="mt">
        <Icon name="folder" />
        <span>Хранилище</span>
      </button>
    </nav>
  )
}

export function Palette() {
  return (
    <>
      <div class="palette-backdrop" data-palette-backdrop></div>
      <div class="palette" role="dialog" aria-label="Поиск" data-palette>
        <div class="palette-field">
          <Icon name="search" />
          <input
            class="palette-input"
            data-palette-input
            placeholder="Найти заметку или #тег…"
            autocomplete="off"
            spellcheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div class="palette-list" data-palette-list></div>
        <div class="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> выбрать
          </span>
          <span>
            <kbd>↵</kbd> открыть
          </span>
          <span class="palette-count" data-palette-count></span>
        </div>
      </div>
    </>
  )
}

/* ───────────── настройки ───────────── */

function Seg({ opt, label, items }: { opt: string; label: string; items: [string, string][] }) {
  return (
    <div class="set-seg" role="radiogroup" aria-label={label} data-opt={opt}>
      {items.map(([v, text]) => (
        <button type="button" role="radio" data-v={v}>
          {text}
        </button>
      ))}
    </div>
  )
}

const SKINS: { v: string; name: string; cls: string }[] = [
  { v: "linear", name: "Linear", cls: "pv-linear" },
  { v: "github", name: "GitHub", cls: "pv-github" },
  { v: "console", name: "Консоль", cls: "pv-console" },
]

export function Settings() {
  return (
    <>
      <div class="set-backdrop" data-settings-close></div>
      <div class="settings" role="dialog" aria-label="Настройки" data-settings-dialog>
        <nav class="set-nav" aria-label="Разделы настроек">
          <b class="set-h">Настройки</b>
          <button type="button" data-set-tab="view" class="on">
            Вид
          </button>
          <button type="button" data-set-tab="gtasks" class="kb-auth-only">
            Google Tasks
          </button>
          <button type="button" data-set-tab="account">
            Аккаунт
          </button>
        </nav>
        <div class="set-body">
          <div class="set-top">
            <h2 data-set-title>Вид</h2>
            <button type="button" class="set-x" data-settings-close aria-label="Закрыть">
              <Icon name="x" />
            </button>
          </div>

          <section class="set-pane" data-set-pane="view">
            <div class="set-block">
              <span class="set-l">Оформление</span>
              <div class="set-skins" role="radiogroup" aria-label="Оформление" data-opt="skin">
                {SKINS.map((k) => (
                  <button type="button" role="radio" data-v={k.v} class="set-skin">
                    <span class={`pv ${k.cls}`} aria-hidden="true">
                      <i class="pv-side"></i>
                      <span class="pv-main">
                        <i class="pv-h"></i>
                        <i class="pv-t"></i>
                        <i class="pv-t short"></i>
                      </span>
                    </span>
                    <span class="set-skin-n">{k.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div class="set-line">
              <span class="set-l">Тема</span>
              <Seg
                opt="theme"
                label="Тема"
                items={[
                  ["dark", "Тёмная"],
                  ["light", "Светлая"],
                  ["auto", "Авто"],
                ]}
              />
            </div>
            <div class="set-block">
              <div class="set-line">
                <label class="set-l" for="set-fs">
                  Размер текста
                </label>
                <span class="set-v" data-fs-label>
                  100%
                </span>
              </div>
              <input
                id="set-fs"
                class="set-range"
                type="range"
                min="0"
                max="3"
                step="1"
                data-fs-range
              />
              <p class="set-sample">Read Committed не даёт читать незафиксированные изменения.</p>
            </div>
            <div class="set-line">
              <span class="set-l">Ширина текста</span>
              <Seg
                opt="width"
                label="Ширина текста"
                items={[
                  ["narrow", "Узкая"],
                  ["normal", "Обычная"],
                  ["wide", "Широкая"],
                  ["full", "Во всю"],
                ]}
              />
            </div>
          </section>

          <section class="set-pane gt-row" data-set-pane="gtasks" data-gtasks hidden>
            <p class="gt-status" data-gt-status>
              …
            </p>
            <div class="gt-actions">
              <button type="button" class="gt-btn gt-off-only" data-gt-connect>
                Подключить
              </button>
              <button type="button" class="gt-btn ghost gt-on-only" data-gt-sync>
                Синхронизировать сейчас
              </button>
              <button type="button" class="gt-btn ghost gt-on-only" data-gt-off>
                Отключить
              </button>
            </div>
            <p class="set-note">
              Задачи — чекбоксы в папке «Задачи» (заметка = список) и строки с тегом #задача в любой
              заметке. Синхронизация каждые 5 минут.
            </p>
          </section>

          <section class="set-pane" data-set-pane="account" hidden>
            <div class="set-acc kb-auth-only">
              <img class="set-ava" data-account-avatar alt="" hidden />
              <span class="set-acc-n" data-account-login></span>
              <button type="button" class="gt-btn ghost" data-logout>
                Выйти
              </button>
            </div>
            <div class="set-acc kb-anon-only">
              <span class="set-acc-n">Вы не вошли</span>
              <button type="button" class="gt-btn" data-login>
                Войти через GitHub
              </button>
            </div>
            <p class="set-note">
              Вид (оформление, тема, размер и ширина текста) хранится в этом браузере.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
