import { createFileRoute } from "@tanstack/react-router"
import { DocPage } from "../components/page.js"
import { loadPage, pageHead } from "../lib/page.js"
import { docs } from "../lib/source.js"

export const Route = createFileRoute("/$")({
  component: () => <DocPage data={Route.useLoaderData()} />,
  head: ({ loaderData }) => pageHead(loaderData),
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? []
    const data = await loadPage({ data: slugs })
    await docs.getPage(data.path)?.preload()
    return data
  },
})
