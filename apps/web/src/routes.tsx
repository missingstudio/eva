import { sessionID } from "@missingstudio/eva-schema"
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
} from "@tanstack/react-router"
import { Page } from "./page.js"
import { SESSION_ROUTE } from "./paths.js"
import { Session } from "./session.js"
import { useHeader, useTranscript } from "./transcript.js"

const Shell = () => <Outlet />

/**
 * The one Session the route names, read. The views take what they draw as
 * props, so this is the only place on the page where a read and a drawing
 * meet — and the Header and the record are two reads, because the Header is
 * drawn before the fold has arrived.
 */
const Read = () => {
  const params = useParams({ from: SESSION_ROUTE })
  const session = sessionID(params.session)

  return <Session session={session} header={useHeader(session)} reading={useTranscript(session)} />
}

const root = createRootRoute({ component: Shell })
const index = createRoute({ getParentRoute: () => root, path: "/", component: Page })
const session = createRoute({
  getParentRoute: () => root,
  path: SESSION_ROUTE,
  component: Read,
})

// Code-based routes, so the build needs no route generator and no plugin
// beside the toolchain this repository already has.
export const routeTree = root.addChildren([index, session])

export const makeRouter = () => createRouter({ routeTree })
