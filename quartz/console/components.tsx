import { QuartzComponentProps } from "../components/types"
import { QuartzPluginData } from "../plugins/vfile"
import { Icon } from "./icons"
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
  reviewDate,
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

/* ───────────── шапка ───────────── */

export function Titlebar({ fileData, allFiles, cfg }: P) {
  return (
    <>
      <a class="tb-logo" href={href(fileData.slug, "index")}>
        <span class="tb-mark">
          <Icon name="terminal" />
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

export function Actbar({ fileData }: P) {
  const kind = pageKind(fileData.slug)
  return (
    <nav class="actbar">
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
      <button type="button" data-global-graph class="act" title="Граф связей (Ctrl G)">
        <Icon name="graph" />
      </button>
      <a href={href(fileData.slug, "index") + "#review"} class="act" title="Повторение">
        <Icon name="repeat" />
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

/* ───────────── проводник ───────────── */

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
              <Icon name="folder" cls="fold" />
              <span>{d.name}</span>
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
            class={`f-file ${f.slug === current ? "f-on" : ""}`}
            data-slug={f.slug}
          >
            {title(f)}
            <span class="ext">.md</span>
          </a>
        </li>
      ))}
    </>
  )
}

export function Explorer({ fileData, allFiles }: P) {
  const tree = buildTree(allFiles)
  const current = fileData.slug ?? "index"
  return (
    <>
      <div class="pane-h">
        <span>Хранилище</span>
        <span class="pane-n">{countFiles(tree)}</span>
      </div>
      <ul class="tree">
        <li>
          <a
            href={href(current, "index")}
            class={`f-file f-home ${current === "index" ? "f-on" : ""}`}
          >
            <Icon name="home" />
            Главная
          </a>
        </li>
        <TreeLevel node={tree} current={current} />
      </ul>
    </>
  )
}

/* ───────────── вкладки ───────────── */

export function Tabs({ fileData }: P) {
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
    <div class="tabs">
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

export function Crumbs({ fileData, allFiles, cfg }: P) {
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
    <nav class="crumbs">
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

export function Frontmatter({ fileData }: P) {
  const t = tags(fileData)
  const created = fileData.dates?.created ? new Date(fileData.dates.created).getTime() : 0
  const modified = modifiedTs(fileData)
  const review = reviewDate(fileData)
  return (
    <pre class="fm">
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
      {review && (
        <>
          <span class="fm-k">review:</span> <span class="fm-n">{review}</span>
          {"\n"}
        </>
      )}
      <span class="fm-d">---</span>
    </pre>
  )
}

/* ───────────── оглавление ───────────── */

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
        Оглавление
        <Icon name="chevDown" cls="mt-ic" />
      </summary>
      <Toc {...props} />
    </details>
  )
}

/* ───────────── история (git log) ───────────── */

export function History({ fileData }: P) {
  const hist = fileData.gitHistory ?? []
  if (hist.length === 0) return null
  return (
    <>
      <div class="pane-h">
        <span>История</span>
      </div>
      <ol class="hist">
        {hist.map((c) => (
          <li>
            <span class="l-hash">{c.hash}</span>
            <span>{c.msg}</span>
            <em>
              <Ago ts={c.ts} />
            </em>
          </li>
        ))}
      </ol>
    </>
  )
}

/* ───────────── обратные ссылки ───────────── */

export function Backlinks({ fileData, allFiles }: P) {
  const bl = backlinksOf(allFiles, fileData.slug ?? "")
  if (bl.length === 0) return null
  return (
    <section class="n-end">
      <h2 class="h2">
        Ссылаются сюда <span class="cmt">{bl.length}</span>
      </h2>
      <div class="bl-grid">
        {bl.map((f) => (
          <a class="bl" href={href(fileData.slug, f.slug!)}>
            <span class="bl-p">{folderOf(f) ?? "/"}</span>
            <b>{title(f)}</b>
            {desc(f) && <span>{desc(f)}</span>}
          </a>
        ))}
      </div>
    </section>
  )
}

/* ───────────── главная ───────────── */

function Card({
  f,
  from,
  i,
  wide,
}: {
  f: QuartzPluginData
  from: string
  i: number
  wide?: boolean
}) {
  const t = tags(f)
  return (
    <a
      class={`card ${wide ? "c-wide" : ""}`}
      href={href(from, f.slug!)}
      data-key={i + 1}
      data-slug={f.slug}
    >
      <span class="c-top">
        <span class="c-path">
          <Icon name="folder" />
          {folderOf(f) ?? "/"}
        </span>
        <span class="c-when">
          <Ago ts={modifiedTs(f)} />
        </span>
      </span>
      <b class="c-t">{title(f)}</b>
      {desc(f) && <p class="c-x">{desc(f)}</p>}
      <span class="c-bot">
        <span class="c-tags">{t.map((x) => `#${x}`).join(" ")}</span>
        {i < 8 && <kbd class="c-k">{i + 1}</kbd>}
      </span>
    </a>
  )
}

export function Home(props: P) {
  const { fileData, allFiles } = props
  const from = fileData.slug ?? "index"
  const all = notes(allFiles)
  const recent = [...all].sort((a, b) => modifiedTs(b) - modifiedTs(a)).slice(0, 8)
  const pinned = all.filter(isPinned).sort((a, b) => title(a).localeCompare(title(b), "ru"))
  const review = all
    .map((f) => ({ f, due: reviewDate(f) }))
    .filter((x) => x.due)
    .sort((a, b) => a.due!.localeCompare(b.due!))
  const folders = topFolders(allFiles)
  return (
    <div class="home-wrap">
      <div class="hero">
        <button class="big-search" data-search type="button">
          <Icon name="search" />
          <span>Что ищем?</span>
          <span class="bs-hint">заметки, теги, заголовки</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div class="chips">
          {folders.map((d) => (
            <a href={folderHref(from, d.slug)} class="chip">
              {d.name} <span>{d.count}</span>
            </a>
          ))}
        </div>
      </div>

      <section class="sec">
        <div class="sec-h">
          <h2 class="h2">Недавние</h2>
          <div class="seg" data-seg>
            <button type="button" class="on" data-mode="modified">
              изменённые
            </button>
            <button type="button" data-mode="opened">
              открытые
            </button>
          </div>
          <span class="sec-sp"></span>
          <span class="kh">
            <kbd>1</kbd>–<kbd>8</kbd> открыть
          </span>
          <div class="vt" data-vt>
            <button type="button" class="on" data-mode="grid" aria-label="Карточки">
              <Icon name="grid" />
            </button>
            <button type="button" data-mode="list" aria-label="Список">
              <Icon name="list" />
            </button>
          </div>
        </div>
        <div class="cards" data-cards>
          {recent.map((f, i) => (
            <Card f={f} from={from} i={i} wide={i === 0} />
          ))}
          {recent.length === 0 && <p class="empty">Пока нет заметок — создай первую в Obsidian.</p>}
        </div>
        <div class="cards" data-cards-opened hidden></div>
      </section>

      <div class="two">
        <section class="sec">
          <div class="sec-h">
            <h2 class="h2">Закреплённые</h2>
            <span class="sec-n">{pinned.length}</span>
          </div>
          {pinned.length > 0 ? (
            <ul class="rows">
              {pinned.map((f) => (
                <li>
                  <a href={href(from, f.slug!)}>
                    <Icon name="star" cls="pin" />
                    <span class="r-t">{title(f)}</span>
                    <span class="r-p">{folderOf(f) ?? ""}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p class="empty">
              Добавь <code>pinned: true</code> во frontmatter заметки.
            </p>
          )}
        </section>
        <section class="sec" id="review">
          <div class="sec-h">
            <h2 class="h2">Повторить сегодня</h2>
            <span class="sec-n" data-review-count></span>
          </div>
          <ul class="todo" data-review>
            {review.map(({ f, due }) => (
              <li data-due={due} data-slug={f.slug}>
                <label>
                  <input type="checkbox" />
                  <span class="box">
                    <Icon name="check" />
                  </span>
                  <a class="td-t" href={href(from, f.slug!)}>
                    {title(f)}
                  </a>
                  <span class="td-d">{due}</span>
                </label>
              </li>
            ))}
          </ul>
          <p class="empty" data-review-empty hidden>
            На сегодня всё. <span data-review-next></span>
          </p>
        </section>
      </div>
    </div>
  )
}

/* ───────────── статусбар и мобильные вкладки ───────────── */

export function Statusbar({ fileData, allFiles }: P) {
  const kind = pageKind(fileData.slug)
  return (
    <footer class="statusbar">
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
      <button class="sb-item" type="button" data-theme-toggle>
        <span class="sb-theme"></span>
      </button>
    </footer>
  )
}

export function MobileTabs({ fileData }: P) {
  const kind = pageKind(fileData.slug)
  return (
    <nav class="m-tabs">
      <a href={href(fileData.slug, "index")} class={`mt ${kind === "home" ? "on" : ""}`}>
        <Icon name="home" />
        <span>Главная</span>
      </a>
      <button type="button" data-drawer class="mt">
        <Icon name="folder" />
        <span>Файлы</span>
      </button>
      <button type="button" data-search class="mt">
        <Icon name="search" />
        <span>Поиск</span>
      </button>
      <button type="button" data-global-graph class="mt">
        <Icon name="graph" />
        <span>Граф</span>
      </button>
      <button type="button" class="mt tt" data-theme-toggle>
        <Icon name="sun" cls="i-sun" />
        <Icon name="moon" cls="i-moon" />
        <span>Тема</span>
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
            placeholder="Найти заметку или тег…"
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
