import { entity, faqGraph, homeGraph, ogSiteName, origin, titleTemplate } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import screenshot from "../../../../assets/eva-cli.png"
import { siteData } from "../lib/site.js"
import { faq } from "../marketing/faq.js"
import {
  Close,
  Faq,
  Hero,
  OpenSource,
  Page,
  Reveals,
  Screenshot,
  Today,
} from "../marketing/sections.js"

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: titleTemplate.web() },
      { name: "description", content: entity.product.description },
      { property: "og:title", content: titleTemplate.web() },
      { property: "og:description", content: entity.product.description },
      { property: "og:url", content: origin.web },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: ogSiteName.web },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: origin.web }],
  }),
  component: Home,
})

function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeGraph(siteData.version)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqGraph([...faq])) }}
      />
      <Reveals />
      <Page>
        <Hero />
        <Screenshot src={screenshot} />
        <Today />
        <OpenSource />
        <Faq />
        <Close />
      </Page>
    </>
  )
}
