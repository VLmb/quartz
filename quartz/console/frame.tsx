import { PageFrame, PageFrameProps } from "../components/frames/types"
import { QuartzComponent } from "../components/types"
import {
  Actbar,
  Backlinks,
  Crumbs,
  Explorer,
  Frontmatter,
  History,
  Home,
  MobileTabs,
  MobileToc,
  Palette,
  Statusbar,
  Tabs,
  Toc,
} from "./components"
import { pageKind, title } from "./data"
import { Icon } from "./icons"

/**
 * Каркас «Консоль»: шапка, панель активности, проводник, редактор с вкладками,
 * правая панель (структура, связи, история), статусбар и мобильные вкладки.
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
    return (
      <div class="shell" data-kind={kind}>
        <header class="titlebar">{render(header)}</header>
        <Actbar {...p} />
        <aside class="explorer" data-explorer>
          <Explorer {...p} />
        </aside>
        <main class="editor center">
          <Tabs {...p} />
          {kind === "home" ? (
            <div class="view home">
              <Home {...p} />
              <section class="sec readme">
                <div class="sec-h">
                  <h2 class="h2">index.md</h2>
                </div>
                <div class="prose">
                  <Content {...p} />
                </div>
              </section>
            </div>
          ) : (
            <div class="view note-view">
              <Crumbs {...p} />
              {isNote && <Frontmatter {...p} />}
              <h1 class="h1 n-title">
                {kind === "tag" && p.fileData.slug !== "tags/index"
                  ? `#${title(p.fileData)}`
                  : title(p.fileData)}
              </h1>
              {isNote && <MobileToc {...p} />}
              <div class="popover-hint">{render(beforeBody)}</div>
              <div class={`prose ${kind !== "note" ? "listing" : ""}`}>
                <Content {...p} />
              </div>
              {render(afterBody)}
              {isNote && <Backlinks {...p} />}
            </div>
          )}
        </main>
        <aside class="panel">
          {isNote && (
            <>
              {(p.fileData.toc ?? []).length > 0 && (
                <>
                  <div class="pane-h">
                    <span>Структура</span>
                  </div>
                  <Toc {...p} />
                </>
              )}
              <div class="pane-h">
                <span>Связи</span>
                <button type="button" class="pane-btn" data-global-graph title="Весь граф (Ctrl G)">
                  <Icon name="graph" />
                </button>
              </div>
              <div class="p-graph">{render(right)}</div>
              <History {...p} />
            </>
          )}
          {!isNote && <div class="p-graph p-hidden">{render(right)}</div>}
        </aside>
        <Statusbar {...p} />
        {render(footer)}
        <MobileTabs {...p} />
        <div class="drawer-backdrop" data-drawer-backdrop></div>
        <Palette />
      </div>
    )
  },
}
