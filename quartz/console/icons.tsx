import { paths } from "./iconPaths"
export { iconString } from "./iconPaths"

export function Icon({ name, cls }: { name: keyof typeof paths | string; cls?: string }) {
  return (
    <svg
      class={`ic ${cls ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths[name] ?? "" }}
    />
  )
}
