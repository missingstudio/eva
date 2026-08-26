import { themeScript } from "@missingstudio/ui"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"
import type { ReactNode } from "react"
import { ThemeBridge } from "../components/theme-bridge.js"
import appCss from "../styles/app.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // The browser chrome takes the page's own ground, per scheme. One value
      // would paint the chrome of one of the two schemes wrong.
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#fafafa" },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#000000" },
      { property: "og:image", content: "https://missing.studio/brand/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: "https://missing.studio/brand/og.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/*
          Before paint, so the page never renders in the wrong scheme. It also
          seeds the key next-themes reads, so the two agree from the start
          rather than fighting on hydration — the cookie is what crosses the
          origin between this site and the marketing one.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        {/* The first focusable element on the page. */}
        <a
          href="#nd-page"
          className="btn-secondary sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
        >
          Skip to content
        </a>
        <RootProvider>
          <ThemeBridge />
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
