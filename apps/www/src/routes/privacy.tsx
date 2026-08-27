import { createFileRoute } from "@tanstack/react-router"
import { privacy } from "../content/privacy.js"
import { pageHead } from "../lib/head.js"
import { ProsePage } from "../marketing/prose.js"

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageHead({ title: privacy.title, description: privacy.description, path: "/privacy" }),
  component: () => <ProsePage prose={privacy} />,
})
