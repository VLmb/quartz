import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { frameRegistry } from "./quartz/components/frames/registry"
import { PageTypeDispatcher } from "./quartz/plugins/pageTypes/dispatcher"
import ConsoleChrome, { ConsoleFrame, GitHistory, PWA, SvgEmbedFix } from "./quartz/console"

// Тема «Консоль»: свой каркас страницы, шапка (несёт стили и скрипты темы),
// исправление SVG-вставок, история правок из git и PWA. Код темы — в quartz/console.
frameRegistry.register("console", ConsoleFrame, "quartz/console")

const config = await loadQuartzConfig()

const transformers = config.plugins.transformers
const crawlIdx = transformers.findIndex((t) => t.name === "LinkProcessing")
transformers.splice(crawlIdx >= 0 ? crawlIdx : transformers.length, 0, SvgEmbedFix())
transformers.push(GitHistory({ limit: 5 }))

// Раскладка: всё, кроме графа связей, рисует каркас «Консоль» сам.
const base = await loadQuartzLayout()
const consoleLayout = {
  frame: "console",
  header: [ConsoleChrome(undefined)],
  left: [],
  right: base.defaults.right ?? [],
  beforeBody: [],
  afterBody: [],
  footer: [],
}
const byPageType: typeof base.byPageType = {}
for (const [name, pt] of Object.entries(base.byPageType)) {
  byPageType[name] = { ...pt, ...consoleLayout }
}
export const layout = {
  defaults: { ...base.defaults, ...consoleLayout },
  byPageType,
}

// loadQuartzConfig уже создал диспетчер страниц с раскладкой из YAML — заменяем на нашу.
const emitters = config.plugins.emitters
const dispatcherIdx = emitters.findIndex((e) => e.name === "PageTypeDispatcher")
const dispatcher = PageTypeDispatcher(layout)
if (dispatcherIdx >= 0) emitters[dispatcherIdx] = dispatcher
else emitters.push(dispatcher)
emitters.push(PWA())

export default config
