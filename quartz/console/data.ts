import { QuartzPluginData } from "../plugins/vfile"
import { FullSlug, resolveRelative, slugTag } from "../util/path"

export type GitCommit = { hash: string; msg: string; ts: number }

declare module "vfile" {
  interface DataMap {
    gitHistory: GitCommit[]
  }
}

export type PageKind = "home" | "note" | "folder" | "tag" | "404"

export function pageKind(slug: string | undefined): PageKind {
  if (!slug || slug === "index") return "home"
  if (slug === "404") return "404"
  if (slug === "tags" || slug.startsWith("tags/")) return "tag"
  if (slug.endsWith("/index")) return "folder"
  return "note"
}

/** Настоящая заметка из vault (не главная, не служебные и не виртуальные страницы). */
export function isNote(f: QuartzPluginData): boolean {
  const slug = f.slug ?? ""
  const rel = (f.relativePath ?? f.filePath ?? "") as string
  if (!rel.endsWith(".md")) return false
  return pageKind(slug) === "note"
}

export function notes(allFiles: QuartzPluginData[]): QuartzPluginData[] {
  return allFiles.filter(isNote)
}

export function title(f: QuartzPluginData): string {
  return (f.frontmatter?.title as string) ?? (f.slug ?? "").split("/").pop() ?? ""
}

export function desc(f: QuartzPluginData): string {
  const d = (f.frontmatter?.description as string) ?? f.description ?? ""
  return d.trim()
}

export function tags(f: QuartzPluginData): string[] {
  const t = f.frontmatter?.tags
  return Array.isArray(t) ? (t as string[]) : []
}

export function modifiedTs(f: QuartzPluginData): number {
  const d = f.dates?.modified ?? f.dates?.created
  return d ? new Date(d).getTime() : 0
}

/** Путь файла в vault, разбитый на сегменты: ["Базы данных", "Индексы.md"]. */
export function pathSegments(f: QuartzPluginData): string[] {
  const rel = ((f.relativePath ?? f.filePath ?? "") as string).replace(/\\/g, "/")
  return rel.split("/").filter(Boolean)
}

/** Человеческое имя папки по её slug (берём из исходного пути файлов). */
export function folderNames(allFiles: QuartzPluginData[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of notes(allFiles)) {
    const segs = pathSegments(f)
    const slugSegs = (f.slug ?? "").split("/")
    for (let i = 0; i < segs.length - 1; i++) {
      map.set(slugSegs.slice(0, i + 1).join("/"), segs[i])
    }
  }
  return map
}

export function folderOf(f: QuartzPluginData): string | null {
  const segs = pathSegments(f)
  return segs.length > 1 ? segs[segs.length - 2] : null
}

export function topFolders(
  allFiles: QuartzPluginData[],
): { slug: string; name: string; count: number }[] {
  const names = folderNames(allFiles)
  const counts = new Map<string, number>()
  for (const f of notes(allFiles)) {
    const s = (f.slug ?? "").split("/")
    if (s.length > 1) counts.set(s[0], (counts.get(s[0]) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, name: names.get(slug) ?? slug, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

export function href(from: string | undefined, to: string): string {
  return resolveRelative((from ?? "index") as FullSlug, to as FullSlug)
}

export function tagHref(from: string | undefined, tag: string): string {
  return href(from, `tags/${slugTag(tag)}`)
}

export function folderHref(from: string | undefined, folderSlug: string): string {
  return href(from, `${folderSlug}/index`)
}

export function wordCount(f: QuartzPluginData): number {
  return (f.text ?? "").split(/\s+/).filter(Boolean).length
}

export function readingMinutes(f: QuartzPluginData): number {
  return Math.max(1, Math.round(wordCount(f) / 180))
}

const months = [
  "янв.",
  "февр.",
  "марта",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
]
export function shortDate(ts: number): string {
  if (!ts) return ""
  const d = new Date(ts)
  return `${d.getDate()} ${months[d.getMonth()]}`
}

export function isoDay(ts: number): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : ""
}

/** Дата повторения из frontmatter (review: 2026-11-10) в формате YYYY-MM-DD. */
export function reviewDate(f: QuartzPluginData): string | null {
  const r = f.frontmatter?.review as unknown
  if (!r) return null
  if (r instanceof Date) return r.toISOString().slice(0, 10)
  const s = String(r).trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

export function isPinned(f: QuartzPluginData): boolean {
  const p = f.frontmatter?.pinned as unknown
  return p === true || p === "true"
}

export function backlinksOf(allFiles: QuartzPluginData[], slug: string): QuartzPluginData[] {
  const simple = slug.endsWith("/index") ? slug.slice(0, -6) : slug
  return notes(allFiles).filter(
    (f) => f.slug !== slug && (f.links ?? []).some((l) => l === simple || l === slug),
  )
}
