import { QuartzComponent, QuartzComponentConstructor } from "../components/types"
import { Topbar } from "./components"
// @ts-ignore
import script from "./scripts/console.inline"
import style from "./styles/console.scss"

export { ConsoleFrame } from "./frame"
export { SvgEmbedFix, GitHistory, PWA } from "./plugins"
export { EditorBundle, buildEditorBundle } from "./editorBundle"

// Тема, оформление и настройки вида выставляются до отрисовки страницы, чтобы не было вспышки.
const themeScript = `(function(){var d=document.documentElement;function g(k){try{return localStorage.getItem(k)}catch(e){return null}}
var t=g("theme");if(t!=="light"&&t!=="dark")t="dark";
var s=g("skin");if(s!=="console")s="linear";
d.setAttribute("saved-theme",t);d.setAttribute("data-skin",s);
var w=g("kb-width");if(/^(narrow|wide|full)$/.test(w||""))d.setAttribute("data-width",w);
var f=g("kb-fs");if(/^(s|l|xl)$/.test(f||""))d.setAttribute("data-fs",f);
if(g("kb-panel")==="off")d.setAttribute("data-panel","off")})()`

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
