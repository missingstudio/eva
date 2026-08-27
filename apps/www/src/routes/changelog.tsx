import { createFileRoute } from "@tanstack/react-router"
import { changelog } from "../content/changelog.js"
import { pageHead } from "../lib/head.js"
import { Page } from "../marketing/sections.js"

export const Route = createFileRoute("/changelog")({
  head: () =>
    pageHead({ title: changelog.title, description: changelog.description, path: "/changelog" }),
  component: Changelog,
})

// This page keeps its own markup: it is a heading, a sentence, and a link
// rather than a document, so the prose renderer would set it wrongly.
function Changelog() {
  return (
    <Page className="max-w-page mx-auto px-6 pt-24 pb-20">
      <h1 className="d-1">{changelog.title}</h1>
      <p className="text-muted-foreground max-w-measure mt-4">{changelog.lede}</p>
      <p className="mt-8 text-sm">
        <a className="text-bone underline underline-offset-4" href={changelog.link.href}>
          {changelog.link.label} →
        </a>
      </p>
    </Page>
  )
}
