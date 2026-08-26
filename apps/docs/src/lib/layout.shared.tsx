import { entity, external, links } from "@missingstudio/ui"
import type { LayoutTab } from "fumadocs-ui/layouts/shared"
import type { DocsLayoutProps } from "fumadocs-ui/layouts/notebook"

export const site = links(import.meta.env.DEV)

/** The wordmark from the brand kit, inheriting the surrounding text colour. */
function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <img src="/brand/monogram.svg" alt="" width={18} height={16} className="dark:invert" />
      <span className="text-[0.95rem] font-medium tracking-tight">
        {entity.product.name} <span className="text-muted-foreground font-normal">Docs</span>
      </span>
    </span>
  )
}

/**
 * The tab row. Two real destinations today. Pricing, an API reference, and MCP
 * arrive with the managed service and the HTTP surface; a tab for a page
 * nobody has written is the honesty rule's problem, not a placeholder.
 */
export const tabs: LayoutTab[] = [
  { title: "Docs", url: "/", urls: new Set(["/"]) },
  { title: "CLI Reference", url: "/reference/cli" },
]

export function baseOptions(): Omit<DocsLayoutProps, "tree"> {
  return {
    nav: {
      // A full-width bar with the search in the middle, rather than a search
      // box wedged into the sidebar.
      mode: "top",
      title: <Wordmark />,
      url: "/",
    },
    tabMode: "navbar",
    tabs,
    // The page tree is a navigation region and has to say so, and say which
    // one it is: a reader who meets three unnamed regions has to enter each to
    // find out what it holds.
    sidebar: { role: "navigation", "aria-label": "Documentation" },
    githubUrl: external.repo,
    searchToggle: { enabled: true },
    // Three states, not two. A binary switch cannot say "follow the system",
    // and once a reader has touched it, it never can again.
    themeSwitch: { mode: "light-dark-system" },
    links: [
      { type: "main", text: "Website", url: site.web, external: true },
      {
        type: "main",
        text: "Roadmap",
        url: "/about/roadmap",
      },
    ],
  }
}
