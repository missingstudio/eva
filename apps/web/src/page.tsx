import type { SessionHeader } from "@missingstudio/eva-core"
import { buildLine } from "./build.js"
import { sessionHref } from "./paths.js"
import { useSessions } from "./sessions.js"

/**
 * One Session, as its Header names it. A Run says the title, so a Session
 * that has heard nothing has none — and it is named by its id rather than
 * left off the page, because a Session a person cannot see is one they cannot
 * open.
 *
 * A plain anchor, so the listing is provable without a router standing behind
 * it. `eva.web` answers a path with no extension with the page, so the route
 * is resolved on the load the anchor makes.
 */
const Row = ({ session }: { readonly session: SessionHeader }) => (
  <li>
    <a className="title" href={sessionHref(session.id)}>
      {session.title ?? "no title yet"}
    </a>
    <code>{session.id}</code>
    {session.updatedAt === undefined ? null : (
      <time dateTime={session.updatedAt}>{session.updatedAt}</time>
    )}
  </li>
)

/**
 * The Sessions Eva holds. It is handed the listing rather than reading one, so
 * what the page draws is provable without a socket.
 */
export const Listing = ({ sessions }: { readonly sessions: readonly SessionHeader[] }) =>
  sessions.length === 0 ? (
    <p className="note">Eva holds no Session yet.</p>
  ) : (
    <ul className="sessions">
      {sessions.map((one) => (
        <Row key={one.id} session={one} />
      ))}
    </ul>
  )

/**
 * W1's first read: the page lists the Sessions Eva holds, over the wire
 * `eva.api` serves and through the Client that answers for it.
 */
export const Page = () => {
  const listing = useSessions()

  return (
    <main>
      <h1>Eva</h1>
      <p className="build">
        the page that watches · build <code>{buildLine()}</code>
      </p>
      {listing.kind === "reading" ? (
        <p className="note">Reading the Sessions…</p>
      ) : (
        <Listing sessions={listing.sessions} />
      )}
    </main>
  )
}
