import { PageFrame, PageFrameProps } from "../components/frames/types"
import { QuartzComponent } from "../components/types"
import {
  Backlinks,
  History,
  Home,
  MobileTabs,
  MobileToc,
  NoteMeta,
  Palette,
  Properties,
  Sidebar,
  Toc,
} from "./components"
import { pageKind, title } from "./data"
import { Icon } from "./icons"

/**
 * Каркас в стиле Linear: боковая панель (навигация и дерево заметок),
 * верхняя полоса с путём, контент и правая панель (свойства, содержание,
 * связи, история). На телефоне — нижние вкладки и выезжающая панель.
 */
export const ConsoleFrame: PageFrame = {
  name: "console",
  render({
    componentData,
    header,
    beforeBody,
    pageBody: Content,
    afterBody,
    right,
    footer,
  }: PageFrameProps) {
    const p = componentData
    const kind = pageKind(p.fileData.slug)
    const isNote = kind === "note"
    const render = (list: QuartzComponent[]) => list.map((C) => <C {...p} />)
    const heading =
      kind === "tag" && p.fileData.slug !== "tags/index"
        ? `#${title(p.fileData)}`
        : kind === "tag"
          ? "Теги"
          : title(p.fileData)
    return (
      <div class="shell" data-kind={kind}>
        <Sidebar {...p} />
        <main class="main center">
          <header class="topbar">{render(header)}</header>
          {kind === "home" ? (
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
            <section class="pane">
              <div class="pane-h">
                <span>Связи</span>
                <button
                  type="button"
                  class="icon-btn sm"
                  data-global-graph
                  title="Весь граф (Ctrl G)"
                >
                  <Icon name="graph" />
                </button>
              </div>
              <div class="p-graph">{render(right)}</div>
            </section>
            <History {...p} />
          </aside>
        ) : (
          <div class="p-graph p-hidden">{render(right)}</div>
        )}
        {render(footer)}
        <MobileTabs {...p} />
        <div class="drawer-backdrop" data-drawer-backdrop></div>
        <Palette />
      </div>
    )
  },
}
