import { PageFrame, PageFrameProps } from "../components/frames/types"
import { QuartzComponent } from "../components/types"
import {
  Backlinks,
  CActbar,
  CCrumbs,
  CFrontmatter,
  CStatusbar,
  CTabs,
  CTitlebar,
  EditFab,
  History,
  Home,
  MobileTabs,
  MobileToc,
  NoteMeta,
  Palette,
  Properties,
  Settings,
  Sidebar,
  Toc,
} from "./components"
import { notes, pageKind, pathSegments, spaceOfSlug, title } from "./data"
import { QuartzPluginData } from "../plugins/vfile"
import { editorBundle } from "./editorBundle"

/** Настоящий путь папки (с пробелами и регистром) по её slug. */
function realFolder(allFiles: QuartzPluginData[], slug: string): string {
  const depth = slug.split("/").length
  const f = notes(allFiles).find((n) => (n.slug ?? "").startsWith(slug + "/"))
  return f ? pathSegments(f).slice(0, depth).join("/") : ""
}

/**
 * Один каркас на два оформления (переключаются на клиенте атрибутом data-skin):
 * Linear (по умолчанию) и «Консоль». Элементы .skin-l видны только в Linear,
 * .skin-c — только в «Консоли».
 *
 * Linear: боковая панель (навигация и дерево заметок),
 * верхняя полоса с путём, контент и правая панель (свойства, содержание,
 * история). На телефоне — нижние вкладки и выезжающая панель.
 */
export const ConsoleFrame: PageFrame = {
  name: "console",
  render({
    componentData,
    header,
    beforeBody,
    pageBody: Content,
    afterBody,
    footer,
  }: PageFrameProps) {
    const p = componentData
    const space = spaceOfSlug(p.fileData.slug)
    const kind = space ? "space" : pageKind(p.fileData.slug)
    const isNote = kind === "note"
    const render = (list: QuartzComponent[]) => list.map((C) => <C {...p} />)
    const heading =
      kind === "tag" && p.fileData.slug !== "tags/index"
        ? `#${title(p.fileData)}`
        : kind === "tag"
          ? "Теги"
          : title(p.fileData)
    // папка для «Новой заметки»: папка текущей заметки или открытая страница папки
    const folder = isNote
      ? pathSegments(p.fileData).slice(0, -1).join("/")
      : kind === "folder"
        ? realFolder(p.allFiles, (p.fileData.slug ?? "").replace(/\/index$/, ""))
        : ""
    return (
      <div class="shell" data-kind={kind}>
        <header class="titlebar skin-c">
          <CTitlebar {...p} />
        </header>
        <CActbar {...p} />
        <Sidebar {...p} />
        <main
          class="main center"
          data-file-path={isNote ? pathSegments(p.fileData).join("/") : undefined}
          data-folder={folder}
        >
          <header class="topbar skin-l">{render(header)}</header>
          <CTabs {...p} />
          {space ? (
            <div class="view space-view" data-space={space}>
              <div class="space-root" data-space-root={space}></div>
              <div class="space-fallback prose">
                <Content {...p} />
              </div>
            </div>
          ) : kind === "home" ? (
            <div class="view home">
              <Home {...p} />
              <section class="sec readme">
                <div class="prose">
                  <Content {...p} />
                </div>
              </section>
            </div>
          ) : (
            <div class="view note-view">
              <CCrumbs {...p} />
              {isNote && <CFrontmatter {...p} />}
              <h1 class="n-title">{heading}</h1>
              {isNote && <NoteMeta {...p} />}
              {isNote && <MobileToc {...p} />}
              <div class="popover-hint">{render(beforeBody)}</div>
              <div class={`prose ${isNote ? "" : "listing"}`}>
                <Content {...p} />
              </div>
              {render(afterBody)}
              {isNote && <Backlinks {...p} />}
            </div>
          )}
        </main>
        {isNote ? (
          <aside class="panel">
            <Properties {...p} />
            {(p.fileData.toc ?? []).length > 0 && (
              <section class="pane">
                <div class="pane-h">
                  <span>Содержание</span>
                </div>
                <Toc {...p} />
              </section>
            )}
            <History {...p} />
          </aside>
        ) : null}
        <CStatusbar {...p} />
        {render(footer)}
        <MobileTabs {...p} />
        <EditFab {...p} />
        <span
          hidden
          data-editor-url={editorBundle.file}
          data-spaces-url={editorBundle.spaces}
        ></span>
        <div class="drawer-backdrop" data-drawer-backdrop></div>
        <Palette />
        <Settings />
      </div>
    )
  },
}
