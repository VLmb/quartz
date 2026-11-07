// Пространства: страницы «Задачи» и «Inbox» и быстрая запись мысли.
// Грузится отдельным файлом только там, где нужно.
import { setBase } from "./api"
import * as inbox from "./inbox"
import * as tasks from "./tasks"
import type { Ctx } from "./inbox"

let current: "tasks" | "inbox" | null = null
let ctx: Ctx = { flash: () => {} }
let rootUrl = "/"

export function init(o: { root: string; flash: (msg: string) => void }) {
  rootUrl = o.root
  setBase(o.root)
  ctx = { flash: o.flash }
}

/** Вызывается на каждой навигации: монтирует нужное пространство или снимает старое. */
export function onNav() {
  const host = document.querySelector<HTMLElement>("[data-space-root]")
  const space = (host?.dataset.spaceRoot as "tasks" | "inbox" | undefined) ?? null
  if (current === "tasks") tasks.unmount()
  if (current === "inbox") inbox.unmount()
  current = space
  if (!host || !space) return
  if (space === "tasks") tasks.mount(host, ctx, rootUrl)
  else inbox.mount(host, ctx)
}

export function capture() {
  inbox.openCapture(ctx)
}

export function captureOpen() {
  return inbox.captureOpen()
}
