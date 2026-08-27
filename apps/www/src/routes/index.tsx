import { entity, faqGraph, homeGraph } from "@missingstudio/machine"
import { createFileRoute } from "@tanstack/react-router"
import screenshot from "../../../../assets/eva-cli.png"
import { pageHead } from "../lib/head.js"
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
  head: () => pageHead({ description: entity.product.description, path: "" }),
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
