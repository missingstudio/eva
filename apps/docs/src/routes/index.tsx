import { createFileRoute } from "@tanstack/react-router"
import { DocPage } from "../components/page.js"
import { loadPage, pageHead } from "../lib/page.js"
import { docs } from "../lib/source.js"

// The home page is an explicit route rather than a splat match on "". A root
// splat may or may not match "/" depending on the router version, and the
// front door is not the place to find out.
export const Route = createFileRoute("/")({
  component: () => <DocPage data={Route.useLoaderData()} />,
  head: ({ loaderData }) => pageHead(loaderData),
  loader: async () => {
    const data = await loadPage({ data: [] })
    await docs.getPage(data.path)?.preload()
    return data
  },
})
