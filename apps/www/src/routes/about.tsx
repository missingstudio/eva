import { origin, trustPageGraph } from "@missingstudio/ui"
import { createFileRoute } from "@tanstack/react-router"
import { about } from "../content/about.js"
import { pageHead } from "../lib/head.js"
import { ProsePage } from "../marketing/prose.js"

const graph = trustPageGraph({
  type: "AboutPage",
  title: about.title,
  description: about.description,
  url: `${origin.web}/about`,
})

export const Route = createFileRoute("/about")({
  head: () => pageHead({ title: about.title, description: about.description, path: "/about" }),
  component: () => (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
      />
      <ProsePage prose={about} />
    </>
  ),
})
