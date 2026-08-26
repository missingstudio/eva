import { entity, ogSiteName, origin, titleTemplate } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { Page } from "../marketing/sections.js"

const description = `What ${origin.web} stores, and what it sends elsewhere.`
const url = `${origin.web}/privacy`

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: titleTemplate.web("Privacy") },
      { name: "description", content: description },
      { property: "og:title", content: titleTemplate.web("Privacy") },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: ogSiteName.web },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
  component: Privacy,
})

/*
  Everything on this page is a statement about what the code in this repository
  does. It carries no claim that cannot be checked against the tree: the one
  cookie is written by packages/ui/src/theme.ts, the two typefaces are files
  in packages/ui/fonts, and there is no analytics call anywhere in either
  site. A page that promised more than that would be marketing copy.
*/
function Privacy() {
  return (
    <Page className="max-w-page mx-auto px-6 pt-24 pb-20">
      <h1 className="d-1 max-w-measure">Privacy</h1>
      <p className="lede max-w-measure mt-6">
        This site stores one thing, sends nothing to a third party, and has no analytics.
      </p>

      <h2 className="d-2 max-w-measure mt-16">The one cookie</h2>
      <p className="text-muted-foreground max-w-measure mt-4">
        A cookie named <code className="text-code">eva-theme</code> records whether you chose the
        light theme, the dark theme, or the system default. It holds one of those three words and
        nothing else. It is scoped to <code className="text-code">missing.studio</code> so the
        documentation site shows the theme you picked here.
      </p>
      <p className="text-muted-foreground max-w-measure mt-4">
        The cookie is set only when you use the theme control, and it stores a preference you asked
        for. Clearing your browser&rsquo;s cookies removes it, and the site returns to following
        your system setting.
      </p>

      <h2 className="d-2 max-w-measure mt-16">What this site does not do</h2>
      <ul className="text-muted-foreground max-w-measure mt-4 space-y-2">
        <li>No analytics, no tracking pixel, and no session recording.</li>
        <li>No advertising, and no data sold or shared with an advertiser.</li>
        <li>No account, and no form that asks for a name or an address.</li>
        <li>
          No third-party fonts or scripts. Both typefaces are served from this origin, so no other
          company sees your request.
        </li>
      </ul>

      <h2 className="d-2 max-w-measure mt-16">Where a request does leave</h2>
      <p className="text-muted-foreground max-w-measure mt-4">
        Links to GitHub, npm, and the license text go to those companies, and their own policies
        apply once you follow one. Nothing is sent to them until you do.
      </p>
      <p className="text-muted-foreground max-w-measure mt-4">
        This site is served by Cloudflare, which processes the request in order to answer it.
      </p>

      <h2 className="d-2 max-w-measure mt-16">Eva, the program</h2>
      <p className="text-muted-foreground max-w-measure mt-4">
        Eva runs on your machine. It writes its sessions to disk under your home directory and reads
        a repository&rsquo;s configuration only after you grant it. This page covers this website;
        what the program stores is documented with the program.
      </p>

      <h2 className="d-2 max-w-measure mt-16">Questions</h2>
      <p className="text-muted-foreground max-w-measure mt-4">
        {entity.company.name} publishes this site. Open an issue on the repository and it will be
        answered in public.
      </p>
    </Page>
  )
}
