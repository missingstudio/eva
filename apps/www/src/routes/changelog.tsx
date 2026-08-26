import { entity, external, ogSiteName, origin, titleTemplate } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { Page } from "../marketing/sections.js"

const description = `Every ${entity.product.name} release, and what changed in it.`
const url = `${origin.web}/changelog`

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: titleTemplate.web("Changelog") },
      { name: "description", content: description },
      { property: "og:title", content: titleTemplate.web("Changelog") },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: ogSiteName.web },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: url }],
  }),
  component: Changelog,
})

function Changelog() {
  return (
    <Page className="max-w-page mx-auto px-6 pt-24 pb-20">
      <h1 className="d-1">Changelog</h1>
      <p className="text-muted-foreground max-w-measure mt-4">
        Every release is published on GitHub with its notes, its checksums, and a provenance
        attestation.
      </p>
      <p className="mt-8 text-sm">
        <a className="text-accent underline underline-offset-4" href={`${external.repo}/releases`}>
          View releases on GitHub →
        </a>
      </p>
    </Page>
  )
}
