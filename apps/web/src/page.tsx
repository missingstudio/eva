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
  <li className="flex flex-wrap items-baseline gap-2 border-rule border-t py-2.5">
    <a className="flex-[1_1_12rem] truncate" href={sessionHref(session.id)}>
      {session.title ?? "no title yet"}
    </a>
    <code className="text-muted text-sm">{session.id}</code>
    {session.updatedAt === undefined ? null : (
      <time className="text-muted text-sm" dateTime={session.updatedAt}>
        {session.updatedAt}
      </time>
    )}
  </li>
)

/**
 * The Sessions Eva holds. It is handed the listing rather than reading one, so
 * what the page draws is provable without a socket.
 */
export const Listing = ({ sessions }: { readonly sessions: readonly SessionHeader[] }) =>
  sessions.length === 0 ? (
    <p className="mt-6 text-muted">Eva holds no Session yet.</p>
  ) : (
    <ul className="mt-6 list-none p-0">
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
    <main className="mx-auto max-w-measure px-6 py-16">
      <h1 className="text-3xl">Eva</h1>
      <p className="text-muted text-sm">
        the page that watches · build <code>{buildLine()}</code>
      </p>
      {listing.kind === "reading" ? (
        <p className="mt-6 text-muted">Reading the Sessions…</p>
      ) : (
        <Listing sessions={listing.sessions} />
      )}
    </main>
  )
}
