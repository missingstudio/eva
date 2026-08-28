import { sessionID } from "@missingstudio/eva-schema"
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
} from "@tanstack/react-router"
import { answer, useAsking } from "./asking.js"
import { Commands } from "./command.js"
import { useComposer } from "./composing.js"
import { Page } from "./page.js"
import { SESSION_ROUTE } from "./paths.js"
import { Session } from "./session.js"
import { useHeader, usePipe, useTranscript } from "./transcript.js"

const Shell = () => <Outlet />

/**
 * The one Session the route names, read. The views take what they draw as
 * props, so this is the only place on the page where a read and a drawing
 * meet — and the Header, the record, the pipe and the questions that stand are
 * four reads, because the Header is drawn before the fold has arrived, the
 * pipe is drawn whatever the fold is doing, and a question is not on the
 * record at all.
 *
 * The composer is the fifth, and the one that writes. It is given the
 * questions because a line typed while one stands answers it rather than
 * opening a Run, which is the fold's rule and not this page's.
 */
const Read = () => {
  const params = useParams({ from: SESSION_ROUTE })
  const session = sessionID(params.session)
  const asking = useAsking()

  return (
    <Session
      answer={answer}
      asking={asking}
      command={<Commands session={session} />}
      composer={useComposer(session, asking)}
      header={useHeader(session)}
      pipe={usePipe()}
      reading={useTranscript(session)}
      session={session}
    />
  )
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
