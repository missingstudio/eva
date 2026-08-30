import type { SessionHeader } from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import { titleLine } from "@missingstudio/eva-sdk"
import type { Attention } from "@missingstudio/eva-session-view"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@missingstudio/ui/components/alert-dialog"
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PanelLeftIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { buildLine } from "./build.js"
import { filtered, grouped, movedAt } from "./grouping.js"
import { SESSION_ROUTE, sessionHref } from "./paths.js"
import { opening, retiring, useSessions, type Listing } from "./sessions.js"

/**
 * The frame both routes are drawn inside: the Sessions on a rail that is
 * always there, and the record beside it. The rail belongs to the frame rather
 * than to the listing route, which is the whole point — opening a Session
 * costs the listing nothing, because the listing never unmounted.
 */

interface Rail {
  // Whether the rail is drawn over the record. It is only reachable below the
  // width where the rail has a column of its own.
  readonly shown: boolean
  readonly toggle: () => void
  /**
   * What the watched Session's Run is doing, reported up by the route that
   * reads it. The rail draws the dot and the route holds the read, and one
   * read is all there may be — a second follow of the same Session would be a
   * second answer to what it is doing.
   */
  readonly watch: (running: boolean) => void
}

const RailContext = createContext<Rail>({
  shown: false,
  toggle: () => undefined,
  watch: () => undefined,
})

export const useRail = (): Rail => useContext(RailContext)

const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/**
 * When a Session last moved, said in full, for the one place with room for it.
 * The stamp stays on the element, so a machine still reads the record's own
 * value and only a person reads this — and a person reads it on their own
 * clock, because an ISO stamp in UTC is a time about nobody. The rail's own
 * shorter words are the listing's: a group says when each of its Sessions
 * moved, in its own precision.
 */
export const stampText = (updatedAt: string): string => {
  const moved = movedAt(updatedAt)
  return moved === undefined ? updatedAt : FULL.format(moved)
}

/**
 * Whether a click is the plain one a row answers for itself. A modified click
 * or a middle click is a person asking the browser for a second tab, and the
 * `href` is what answers it — so those are left alone.
 */
const plain = (event: MouseEvent): boolean =>
  event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)

const SideRow = ({
  session,
  moved,
  active,
  running,
  go,
  ask,
}: {
  readonly session: SessionHeader
  // When this Session last moved, in its group's own words.
  readonly moved: (header: SessionHeader) => string
  readonly active: boolean
  readonly running: boolean
  readonly go?: (session: string) => void
  /**
   * Where a press on Delete goes. It opens the question and never the write:
   * the row has no way of its own to put a Session away, so a press that
   * escaped the dialog could not delete by accident.
   */
  readonly ask?: (session: SessionHeader) => void
}) => (
  // The row is an anchor and the control is a button, so they are siblings
  // rather than one inside the other: a button inside a link is a control a
  // browser is free to draw and answer either way.
  <div className="side-item">
    <a
      className="side-row"
      href={sessionHref(session.id)}
      onClick={(event) => {
        // Without this the row is a load, and a load costs the listing: the
        // rail unmounts, reads again, and says it is reading where the
        // Sessions were. The `href` stays, so a rail drawn with nowhere to
        // send a click is the plain anchor it always was.
        if (go === undefined || !plain(event.nativeEvent)) return
        event.preventDefault()
        go(session.id)
      }}
      title={session.title}
      {...(active ? { "aria-current": "page" as const } : {})}
    >
      <span className="t">{titleLine(session.title)}</span>
      <span className="m">
        {/*
           The dot is drawn on the Session this page is watching and on no
           other. What every other Run is doing is not on the listing, and a
           dot guessed onto a row would be the page saying something it cannot
           read.
        */}
        {running ? <i aria-hidden="true" className="dot-run" /> : null}
        {running ? "running · " : null}
        {session.updatedAt === undefined ? null : (
          <time dateTime={session.updatedAt}>{moved(session)}</time>
        )}
      </span>
    </a>
    {/*
       Every row carries it, and a rail drawn with nowhere to send a press
       draws it disabled — the rule New Session keeps, because a control that
       looks live and reaches nothing is worse than one that says it is not.
       The name says which Session, because a rail of identical glyphs names
       nothing to anybody reading it aloud.
    */}
    <button
      aria-label={`Delete ${titleLine(session.title)}`}
      className="side-del"
      disabled={ask === undefined}
      onClick={() => ask?.(session)}
      type="button"
    >
      <Trash2Icon aria-hidden="true" />
    </button>
  </div>
)

/**
 * The Sessions Eva holds, by day, with the one this page is watching marked.
 * It is handed the listing, the clock and what is running, so what the rail
 * draws is provable without a socket and across a day boundary.
 */
export const Sidebar = ({
  listing,
  now,
  watching,
  running = false,
  attention,
  open,
  go,
  retire,
}: {
  readonly listing: Listing
  readonly now: Date
  readonly watching?: string
  readonly running?: boolean
  /**
   * What one Session wants from a person, when the page can say. The rail
   * orders by it, and a row it answers nothing for keeps the order recency
   * gave it — a rail drawn without it is the rail by recency it always was.
   */
  readonly attention?: (header: SessionHeader) => Attention | undefined
  /**
   * Where a press on New Session goes. A rail drawn without one draws the
   * button and disables it, because a control that looks live and reaches
   * nothing is worse than one that says it is not.
   */
  readonly open?: () => void
  /**
   * Where a click on a row goes. It is handed in for the reason the listing
   * itself is: a rail drawn without it is still a rail of working links, and
   * so it is provable without a router standing behind it.
   */
  readonly go?: (session: string) => void
  /**
   * Where the answered question goes: the Session a person confirmed they
   * want gone. It is reached from the dialog and from nowhere else, so the
   * rail cannot put a Session away without having asked.
   */
  readonly retire?: (session: string) => void
}) => {
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState("")
  // The Session a person pressed Delete on, held while they answer. Nothing
  // is written until they do.
  const [asked, setAsked] = useState<SessionHeader | undefined>(undefined)

  const held = listing.kind === "read" ? listing.sessions : []
  const groups = grouped(filtered(held, query), now, attention)

  return (
    <nav aria-label="every Session" className="sidebar">
      <button
        className="side-btn side-new"
        disabled={open === undefined}
        onClick={() => open?.()}
        type="button"
      >
        <PlusIcon aria-hidden="true" />
        New Session
      </button>

      {/*
         The field is revealed where the row was, rather than standing open. A
         rail is narrow, and a control that is always drawn is one more thing
         between a reader and the row they came for.
      */}
      {finding ? (
        <input
          aria-label="Search"
          autoFocus
          className="side-find"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            setQuery("")
            setFinding(false)
          }}
          placeholder="Search"
          value={query}
        />
      ) : (
        <button className="side-btn" onClick={() => setFinding(true)} type="button">
          <SearchIcon aria-hidden="true" />
          Search
        </button>
      )}

      {listing.kind === "reading" ? (
        <p aria-busy="true" className="side-said" role="status">
          Reading the Sessions…
        </p>
      ) : null}

      {listing.kind === "read" && held.length === 0 ? (
        <p className="side-said">Eva holds no Session yet.</p>
      ) : null}

      {/* A listing that holds Sessions and a query that names none are two
          different things, and one word for both would read as the first. */}
      {held.length > 0 && groups.length === 0 ? (
        <p className="side-said" role="status">
          No Session by that name.
        </p>
      ) : null}

      {groups.map((group) => (
        <div key={group.label}>
          <p className="side-label">{group.label}</p>
          {group.sessions.map((one) => (
            <SideRow
              active={one.id === watching}
              key={one.id}
              moved={group.moved}
              running={running && one.id === watching}
              session={one}
              {...(go === undefined ? {} : { go })}
              {...(retire === undefined ? {} : { ask: setAsked })}
            />
          ))}
        </div>
      ))}

      <p className="side-foot">eva.web · build {buildLine()}</p>

      {/*
         One dialog for the whole rail, drawn once and pointed at the row that
         asked. It is the rail's only irreversible gesture, so it is the only
         one that stops and asks — and the button that does it says what it
         does, rather than saying yes to a question a reader has to remember.
      */}
      <AlertDialog
        onOpenChange={(shown) => {
          if (!shown) setAsked(undefined)
        }}
        open={asked !== undefined}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Session?</AlertDialogTitle>
            {/*
               The Session is named first, as a label rather than as the
               subject of the sentence: a title is the record's own words and
               is never recased, so one used to open a sentence reads as a
               sentence that starts in lower case.
            */}
            <AlertDialogDescription>
              {titleLine(asked?.title)} — it leaves this listing. Eva keeps the record it made, and
              nothing on this page brings the Session back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const one = asked
                setAsked(undefined)
                if (one !== undefined) retire?.(one.id)
              }}
              variant="destructive"
            >
              Delete Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </nav>
  )
}

/**
 * The bar over the record: which Session this is, and what it has spent.
 *
 * The spend slot is empty until the fold has arrived. A Session nobody has
 * read yet is not one that spent nothing, and `$0.00` would say it was.
 */
export const TopBar = ({ title, spend }: { readonly title: string; readonly spend?: string }) => {
  const rail = useRail()

  return (
    <div className="topbar">
      {/*
         Below the width where the rail has a column, this is how the listing
         is reached. A phone that cannot reach it is a door that does not open.
      */}
      <button
        aria-expanded={rail.shown}
        aria-label="every Session"
        className="rail-open"
        onClick={rail.toggle}
        type="button"
      >
        <PanelLeftIcon aria-hidden="true" />
      </button>
      {/* The page's one heading. It names the Session a reader is in, which
          is the only thing on the page that says which page it is. */}
      <h1 className="title" title={title}>
        {title}
      </h1>
      {spend === undefined ? null : <span className="spend">{spend}</span>}
    </div>
  )
}

/**
 * The main pane's own column: the scroll region and the dock under it. It is
 * here rather than in each route so both routes hold still the same way — the
 * page body never scrolls, and the transcript region is the one thing that
 * does.
 */
export const Main = ({ children }: { readonly children: ReactNode }) => (
  // The landmark a screen reader skips to, and the thing the skip link above
  // the rail lands on. It takes focus for that and is not in the tab order.
  <main className="main" id="main" tabIndex={-1}>
    {children}
  </main>
)

/** Where the skip link that reaches the field lands. */
export const SAY_NEXT = "say-next"

/**
 * The frame. It reads the listing once, for both routes, and it reads which
 * Session the route names so the rail can mark the row a reader is on.
 */
export const Shell = () => {
  const listing = useSessions()
  const navigate = useNavigate()
  const [shown, setShown] = useState(false)
  const [running, setRunning] = useState(false)

  /**
   * Escape closes the rail. It is the second way out and it has to exist: the
   * trigger that opened the rail is behind it while it is open, so a reader
   * with only the trigger would be shut in.
   */
  useEffect(() => {
    if (!shown) return
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShown(false)
    }
    document.addEventListener("keydown", key)
    return () => document.removeEventListener("keydown", key)
  }, [shown])

  // The Session the route names, read off the router rather than off a param
  // hook, because this component is drawn on the route that names none.
  const watching = useRouterState({
    select: (state) => {
      const params: Record<string, string> = state.matches.at(-1)?.params ?? {}
      return params["session"]
    },
  })

  return (
    <RailContext.Provider
      value={{ shown, toggle: () => setShown((was) => !was), watch: setRunning }}
    >
      {/*
         The rail is a column of Sessions and it is first in the tab order, so
         without these a reader on a keyboard tabs past every Session Eva holds
         to reach the record, and past every fold in the record to reach the
         field. Both are drawn only when focused.

         The second exists exactly where the field does. A link to a place the
         route does not have would be one more thing that reaches nothing.
      */}
      <a className="skip" href="#main">
        skip to the record
      </a>
      {watching === undefined ? null : (
        <a className="skip" href={`#${SAY_NEXT}`}>
          skip to what to say next
        </a>
      )}
      <div className="shell" data-rail={shown ? "shown" : "held"}>
        <Sidebar
          /**
           * What the page can honestly say a row wants. It reads one Session
           * — the one the route names — so that is the one row it answers
           * for, and every other is left unanswered rather than guessed.
           *
           * The fleet view is where every row has an answer: it folds each
           * Trace with `attentionFold` and hands the same function in. The
           * order is already written and nothing about it changes.
           */
          attention={(header) =>
            header.id === watching && running ? { kind: "moving" } : undefined
          }
          go={(session) => {
            setShown(false)
            void navigate({ to: SESSION_ROUTE, params: { session } })
          }}
          listing={listing}
          now={new Date()}
          open={opening}
          /**
           * The write, and the one thing that has to follow it: a reader
           * left on the Session they just put away is a reader on a record
           * the rail no longer offers a way back to. So the page goes where
           * it goes with no Session named.
           *
           * `retiring` reads the listing again for every reader, so the row
           * is gone by the time this navigates.
           */
          retire={(session) => {
            void retiring(sessionID(session)).then(() => {
              if (session === watching) void navigate({ to: "/" })
            })
          }}
          running={running}
          {...(watching === undefined ? {} : { watching })}
        />
        {/* The way out of the open rail, for a reader who reaches for the
            record rather than for the keyboard. */}
        {shown ? (
          <button
            aria-label="close the listing"
            className="rail-scrim"
            onClick={() => setShown(false)}
            type="button"
          />
        ) : null}
        <Outlet />
      </div>
    </RailContext.Provider>
  )
}
