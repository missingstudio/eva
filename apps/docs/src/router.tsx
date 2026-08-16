import { createRouter } from "@tanstack/react-router"
import { NotFound } from "./components/not-found.js"
import { routeTree } from "./routeTree.gen.js"

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    // A branded 404 with a way back, rather than the router's bare default.
    defaultNotFoundComponent: NotFound,
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
