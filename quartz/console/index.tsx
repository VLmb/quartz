import { QuartzComponent, QuartzComponentConstructor } from "../components/types"
import { Topbar } from "./components"
// @ts-ignore
import script from "./scripts/console.inline"
import style from "./styles/console.scss"

export { ConsoleFrame } from "./frame"
export { SvgEmbedFix, GitHistory, PWA } from "./plugins"

// Тема выставляется до отрисовки страницы, чтобы не было вспышки. По умолчанию — тёмная.
const themeScript = `(function(){var t;try{t=localStorage.getItem("theme")}catch(e){}
if(t!=="light"&&t!=="dark")t="dark";
document.documentElement.setAttribute("saved-theme",t)})()`

/**
 * Верхняя полоса темы. Заодно несёт стили и скрипты всей темы,
 * поэтому должна стоять в слоте header.
 */
const ConsoleChrome: QuartzComponentConstructor = () => {
  const C: QuartzComponent = (props) => <Topbar {...props} />
  C.displayName = "ConsoleChrome"
  C.css = style
  C.beforeDOMLoaded = themeScript
  C.afterDOMLoaded = script
  return C
}

export default ConsoleChrome
