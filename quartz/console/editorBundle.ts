// Редактор и «пространства» (Задачи, Inbox) собираются в отдельные файлы и грузятся
// только там, где нужны, чтобы не утяжелять обычные страницы.
import { build } from "esbuild"
import { createHash } from "crypto"
import path from "path"
import { QuartzEmitterPlugin } from "../plugins/types"
import { write } from "../plugins/emitters/helpers"
import { FullSlug } from "../util/path"

export const editorBundle = { file: "", code: "", spaces: "", spacesCode: "" }

async function bundle(entry: string): Promise<string> {
  const res = await build({
    entryPoints: [path.resolve(entry)],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    write: false,
    charset: "utf8",
    legalComments: "none",
  })
  return res.outputFiles[0].text
}

const hashed = (name: string, code: string) =>
  `static/${name}-${createHash("sha256").update(code).digest("hex").slice(0, 8)}.js`

export async function buildEditorBundle() {
  const [editor, spaces] = await Promise.all([
    bundle("quartz/console/editor/main.ts"),
    bundle("quartz/console/spaces/main.ts"),
  ])
  editorBundle.code = editor
  editorBundle.file = hashed("editor", editor)
  editorBundle.spacesCode = spaces
  editorBundle.spaces = hashed("spaces", spaces)
}

export const EditorBundle: QuartzEmitterPlugin = () => ({
  name: "EditorBundle",
  async *emit(ctx) {
    for (const [file, content] of [
      [editorBundle.file, editorBundle.code],
      [editorBundle.spaces, editorBundle.spacesCode],
    ]) {
      if (!file) continue
      yield write({ ctx, slug: file.replace(/\.js$/, "") as FullSlug, ext: ".js", content })
    }
  },
  async *partialEmit() {},
})
