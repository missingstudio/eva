import { origin } from "@missingstudio/machine"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"
import appCss from "../styles/app.css?url"

// One card for both sites, on the marketing origin. site.ts names that origin
// once, so a move of the domain is a move of one line.
const ogImage = `${origin.web}/brand/og.png`

// The Google Analytics property this origin reports to. The value is public:
// it ships in the page it measures.
const measurementId = "G-349PSFMKTG"

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
      // as the well-known path, so a page reached without the site root still
      // names the catalog. Every page carries it, because any page can be the
      // one an agent lands on.
      { rel: "ard", href: `${origin.web}/.well-known/ard.json` },
    ],
    // Page views, counted by Google Analytics. A local run reports nothing,
    // so development traffic stays out of the numbers. `scripts` here is the
    // head list; the route option of the same name renders in the body.
    scripts: import.meta.env.DEV
      ? []
      : [
          { src: `https://www.googletagmanager.com/gtag/js?id=${measurementId}`, async: true },
          {
            children: [
              "window.dataLayer = window.dataLayer || [];",
              "function gtag(){dataLayer.push(arguments);}",
              "gtag('js', new Date());",
              `gtag('config', '${measurementId}');`,
            ].join("\n"),
          },
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
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
