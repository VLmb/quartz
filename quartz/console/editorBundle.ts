// Редактор собирается в отдельный файл и грузится только по кнопке «Редактировать»,
// чтобы не утяжелять обычные страницы (CodeMirror + marked ≈ 300 КБ).
import { build } from "esbuild"
import { createHash } from "crypto"
import path from "path"
import { QuartzEmitterPlugin } from "../plugins/types"
import { write } from "../plugins/emitters/helpers"
import { FullSlug } from "../util/path"

export const editorBundle = { file: "", code: "" }

export async function buildEditorBundle() {
  const res = await build({
    entryPoints: [path.resolve("quartz/console/editor/main.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    write: false,
    charset: "utf8",
    legalComments: "none",
  })
  const code = res.outputFiles[0].text
  editorBundle.code = code
  editorBundle.file = `static/editor-${createHash("sha256").update(code).digest("hex").slice(0, 8)}.js`
}

export const EditorBundle: QuartzEmitterPlugin = () => ({
  name: "EditorBundle",
  async *emit(ctx) {
    if (!editorBundle.file) return
    yield write({
      ctx,
      slug: editorBundle.file.replace(/\.js$/, "") as FullSlug,
      ext: ".js",
      content: editorBundle.code,
    })
  },
  async *partialEmit() {},
})
