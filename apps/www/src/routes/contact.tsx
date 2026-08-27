import { origin, trustPageGraph } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { contact } from "../content/contact.js"
import { pageHead } from "../lib/head.js"
import { ProsePage } from "../marketing/prose.js"

const graph = trustPageGraph({
  type: "ContactPage",
  title: contact.title,
  description: contact.description,
  url: `${origin.web}/contact`,
})

export const Route = createFileRoute("/contact")({
  head: () =>
    pageHead({ title: contact.title, description: contact.description, path: "/contact" }),
  component: () => (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
      />
      <ProsePage prose={contact} />
    </>
  ),
})
