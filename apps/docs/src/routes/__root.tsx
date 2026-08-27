import { origin } from "@missingstudio/ui"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import type { ReactNode } from "react"
import appCss from "../styles/app.css?url"

// One card for both sites, on the marketing origin. site.ts names that origin
// once, so a move of the domain is a move of one line.
const ogImage = `${origin.web}/brand/og.png`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // The browser chrome takes the page's own ground. The system is dark
      // only, so one value is the whole answer.
      { name: "theme-color", content: "#08090a" },
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: ogImage },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      // Agentic Resource Discovery asks a consumer to honour this link as well
      // as the well-known path. A search result lands an agent on a page
      // rather than on a site root, so every page names the catalog.
      { rel: "ard", href: `${origin.docs}/.well-known/ard.json` },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The `dark` class is pinned: the system is dark only, and the class is
    // what keeps the components' `dark:` utilities live.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-dvh flex-col">
        {/* The first focusable element on the page. */}
        <a
          href="#nd-page"
          className="btn-secondary sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
        >
          Skip to content
        </a>
        {/* The theme is not a choice: dark is the system, so the provider's
            own switching is disabled and the class above is the record.

            Search reads the index as a file rather than asking a server for
            each query, because this site is static files and there is no
            server to ask. `api/search` writes that file. */}
        <RootProvider theme={{ enabled: false }} search={{ options: { type: "static" } }}>
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
