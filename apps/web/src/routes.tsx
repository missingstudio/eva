import { sessionID, type SessionID } from "@missingstudio/eva-schema"
import { createRootRoute, createRoute, createRouter, useParams } from "@tanstack/react-router"
import { useEffect } from "react"
import { answer, useAsking } from "./asking.js"
import { useComposer } from "./composer.js"
import { useChoosing } from "./models.js"
import { Page } from "./page.js"
import { SESSION_ROUTE } from "./paths.js"
import { Session } from "./session.js"
import { Shell, useRail } from "./shell.js"
import { useHeader, usePipe, useTranscript } from "./transcript.js"

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
const Read = ({ session }: { readonly session: SessionID }) => {
  const asking = useAsking()
  const reading = useTranscript(session)
  const { watch } = useRail()

  /**
   * What the Run is doing, told to the rail so it can draw the dot on this
   * row. It is reported up rather than read again: the follow is this
   * component's, and a second one for the rail would be a second answer to
   * what one Session is doing.
   */
  useEffect(() => watch(reading.running), [reading.running, watch])

  return (
    <Session
      answer={answer}
      asking={asking}
      choosing={useChoosing(session)}
      composer={useComposer(session, asking)}
      header={useHeader(session)}
      pipe={usePipe()}
      reading={reading}
      session={session}
    />
  )
}

/**
 * Which Session the route names, and a fresh set of reads for it.
 *
 * The key is what makes it fresh. Navigating between Sessions keeps this page
 * — that is the point of the shell — so without it the reads above would hold
 * the Session before this one: the fold, the queue and the tail all outlive
 * their subject, and the page draws one Session's record under another's name
 * until the new fold arrives. On a pipe that is down, that is until it comes
 * back.
 *
 * A new Session is a new subject, so everything read about it starts again.
 */
const Watched = () => {
  const params = useParams({ from: SESSION_ROUTE })
  return <Read key={params.session} session={sessionID(params.session)} />
}

const root = createRootRoute({ component: Shell })
const index = createRoute({ getParentRoute: () => root, path: "/", component: Page })
const session = createRoute({
  getParentRoute: () => root,
  path: SESSION_ROUTE,
  component: Watched,
})

// Code-based routes, so the build needs no route generator and no plugin
// beside the toolchain this repository already has.
export const routeTree = root.addChildren([index, session])

export const makeRouter = () => createRouter({ routeTree })
