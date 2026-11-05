import { execFileSync } from "child_process"
import path from "path"
import { visit } from "unist-util-visit"
import { Element, Root } from "hast"
import { QuartzEmitterPlugin, QuartzTransformerPlugin } from "../plugins/types"
import { write } from "../plugins/emitters/helpers"
import { FullSlug } from "../util/path"
import type { GitCommit } from "./data"
import swTemplate from "./sw.template.js.txt"

/**
 * Obsidian-вставка ![[схема.svg]] превращается в <object>, и Quartz не исправляет
 * путь к файлу — картинка ломается. Превращаем её в <img>, тогда путь
 * разрешается так же, как у PNG/JPG. Должен стоять раньше CrawlLinks.
 */
export const SvgEmbedFix: QuartzTransformerPlugin = () => ({
  name: "SvgEmbedFix",
  htmlPlugins() {
    return [
      () => (tree: Root) => {
        visit(tree, "element", (node: Element) => {
          if (node.tagName !== "object") return
          const props = node.properties ?? {}
          const data = props.data
          if (typeof data !== "string" || !/\.svg($|[?#])/i.test(data)) return
          node.tagName = "img"
          node.properties = {
            src: data,
            alt: (props.ariaLabel as string) || path.basename(data, ".svg"),
            loading: "lazy",
          }
          node.children = []
        })
      },
    ]
  },
})

/** Последние коммиты, которые меняли заметку, — для панели «История». */
export const GitHistory: QuartzTransformerPlugin<{ limit?: number } | undefined> = (opts) => ({
  name: "GitHistory",
  markdownPlugins() {
    const limit = opts?.limit ?? 5
    return [
      () => (_tree, file) => {
        const fp = file.path
        if (!fp) return
        try {
          const out = execFileSync(
            "git",
            ["log", `-n${limit}`, "--follow", "--format=%h%x1f%s%x1f%ct", "--", path.basename(fp)],
            {
              cwd: path.dirname(fp),
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
              timeout: 5000,
            },
          )
          file.data.gitHistory = out
            .split("\n")
            .filter(Boolean)
            .map((line): GitCommit => {
              const [hash, msg, ts] = line.split("\x1f")
              return { hash, msg, ts: Number(ts) * 1000 }
            })
        } catch {
          file.data.gitHistory = []
        }
      },
    ]
  },
})

/** PWA: манифест и service worker в корне сайта. */
export const PWA: QuartzEmitterPlugin<{ description?: string } | undefined> = (opts) => ({
  name: "PWA",
  async *emit(ctx) {
    const cfg = ctx.cfg.configuration
    const manifest = {
      name: `${cfg.pageTitle} — база знаний`,
      short_name: cfg.pageTitle,
      description: opts?.description ?? "Конспекты и подготовка к собеседованиям",
      lang: "ru",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#08090a",
      theme_color: "#08090a",
      icons: [
        { src: "static/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "static/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
        {
          src: "static/pwa/maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
      shortcuts: [
        {
          name: "Поиск",
          url: "./?search=1",
          icons: [{ src: "static/pwa/icon-192.png", sizes: "192x192" }],
        },
      ],
    }
    yield write({
      ctx,
      slug: "manifest" as FullSlug,
      ext: ".webmanifest",
      content: JSON.stringify(manifest, null, 2),
    })
    const version = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14)
    yield write({
      ctx,
      slug: "sw" as FullSlug,
      ext: ".js",
      content: swTemplate.replace("__VERSION__", version),
    })
  },
  async *partialEmit() {},
})
