import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router"
import { Page } from "./page.js"

const Shell = () => <Outlet />

const root = createRootRoute({ component: Shell })
const index = createRoute({ getParentRoute: () => root, path: "/", component: Page })

// Code-based routes, so the build needs no route generator and no plugin
// beside the toolchain this repository already has.
export const routeTree = root.addChildren([index])

export const makeRouter = () => createRouter({ routeTree })
