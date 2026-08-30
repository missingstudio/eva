import type { SessionHeader } from "@missingstudio/eva-core"
import { byAttention, needsAPerson, type Attention } from "@missingstudio/eva-session-view"

/**
 * How the rail arranges the Sessions Eva holds: by what each of them wants
 * from a person, then by the day each Header's own `updatedAt` names, and by
 * the words a reader typed.
 *
 * All three are pure and all three take everything they read. The clock in
 * particular is handed in — a grouping that read `new Date()` for itself could
 * not be tested across a day boundary, and a day boundary is the only place it
 * can be wrong. What a Session wants is handed in for the same reason, and for
 * a second: it is a fold over the Trace and this file folds nothing.
 */

export interface Group {
  readonly label: string
  readonly sessions: readonly SessionHeader[]
  /**
   * When a Session last moved, in this group's own precision. An hour places
   * today and yesterday; further back, an hour says nothing and the day is
   * what a reader wants. How precise to be is the group's own fact, so the
   * words are made here and a drawing never reads a label back and decides
   * for itself. Nothing, for a Session the record does not place in time.
   */
  readonly moved: (header: SessionHeader) => string
}

const UNDATED = "Undated"

/**
 * The one group that is not a day. A Session that is waiting on a person, and
 * one that stopped and cannot go on without one, are the reason a person came
 * to the rail — so they are lifted out of the days and drawn first, whatever
 * day they last moved on.
 *
 * It is drawn only when it holds something, the way every other group is. The
 * rule stands when nothing needs a person; the label does not.
 */
const NEEDS = "Needs you"

/**
 * The buckets, in the order they are drawn, with the last day each one holds.
 * A day is a calendar day and never an elapsed twenty-four hours: two Sessions
 * a minute apart across midnight are a day apart to the person reading them.
 */
const BUCKETS: readonly (readonly [string, number])[] = [
  ["Today", 0],
  ["Yesterday", 1],
  ["This week", 6],
  ["This month", 29],
]

// The two a time of day places. Further back than yesterday, an hour says
// nothing and the day is what a reader is looking for.
const RECENT: readonly string[] = ["Today", "Yesterday"]

/**
 * The two widths a row says a time in. The stamp itself stays on the element,
 * so what a machine reads is the record's own and only what a person reads is
 * shortened — to the reader's clock, because a time of day in another zone is
 * a time of day about nobody.
 */
const HOUR = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

const movedText = (updatedAt: string | undefined, recent: boolean): string => {
  const moved = movedAt(updatedAt)
  if (moved === undefined) return ""
  return (recent ? HOUR : DAY).format(moved)
}

const OLDER = "Older"

// Midnight of the local day a moment falls in. The day is the reader's, so
// the comparison is in local time rather than in the stamp's own zone.
const midnight = (moment: Date): number =>
  new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime()

const A_DAY = 86_400_000

/**
 * Which bucket a Header belongs in, or nothing when it belongs in none.
 *
 * A Header with no `updatedAt`, and one whose stamp cannot be read, both have
 * no place in time — which is not the same as being old, so neither is guessed
 * into a day. A Header stamped ahead of the clock is the most recent thing
 * there is and reads as today.
 */
const bucketOf = (header: SessionHeader, now: Date): string => {
  const moved = movedAt(header.updatedAt)
  if (moved === undefined) return UNDATED

  const days = Math.round((midnight(now) - midnight(new Date(moved))) / A_DAY)
  return BUCKETS.find(([, last]) => days <= last)?.[0] ?? OLDER
}

/**
 * When a Header last moved, as a number, or nothing when the record does not
 * place it in time. A Header with no stamp and one whose stamp cannot be read
 * are the same thing here, and every reader of this file wants the same answer
 * for both.
 */
export const movedAt = (updatedAt: string | undefined): number | undefined => {
  const moved = updatedAt === undefined ? Number.NaN : Date.parse(updatedAt)
  return Number.isNaN(moved) ? undefined : moved
}

/**
 * The Sessions Eva holds: what needs a person first, then by day, and inside
 * a group by what it wants and then by which moved last. A bucket that holds
 * nothing is not drawn: a label over no rows reads as a day whose Sessions
 * failed to arrive.
 *
 * `attention` answers what one Session wants, and it may answer nothing. The
 * page reads one Session at a time, so it can answer for that one and for no
 * other, and a row it cannot answer for keeps the order recency gave it
 * rather than being guessed into a state. When the fleet view reads every
 * Trace, every row has an answer and none of this changes.
 */
export const grouped = (
  headers: readonly SessionHeader[],
  now: Date,
  attention?: (header: SessionHeader) => Attention | undefined,
): readonly Group[] => {
  const wants = (header: SessionHeader): Attention | undefined => attention?.(header)
  const held = new Map<string, SessionHeader[]>()
  for (const header of headers) {
    const label = needsAPerson(wants(header)) ? NEEDS : bucketOf(header, now)
    held.set(label, [...(held.get(label) ?? []), header])
  }

  return [NEEDS, ...BUCKETS.map(([label]) => label), OLDER, UNDATED].flatMap((label) => {
    const sessions = held.get(label)
    if (sessions === undefined) return []
    // The undated have no order to put them in, so they keep the one the
    // listing handed over. A sort is stable, so what the page can read about
    // a row still lifts it and nothing else moves.
    const order = byAttention(wants, label === UNDATED ? () => 0 : byNewest)
    return [
      {
        label,
        // The group of a Session that needs a person holds any day, so the
        // precision is that Session's own day and not the group's.
        moved: (header: SessionHeader) =>
          movedText(
            header.updatedAt,
            RECENT.includes(label === NEEDS ? bucketOf(header, now) : label),
          ),
        sessions: [...sessions].sort(order),
      },
    ]
  })
}

const byNewest = (one: SessionHeader, other: SessionHeader): number =>
  (movedAt(other.updatedAt) ?? 0) - (movedAt(one.updatedAt) ?? 0)

/**
 * The Sessions a typed query names, out of the ones the page already holds.
 *
 * It reaches no wire. A field that searched the far side would be a second
 * read of the listing and a second answer to what Eva holds; this one narrows
 * what is already on the rail. A person types what they remember, so the title
 * and the id are both read, and neither is read for case.
 */
export const filtered = (
  headers: readonly SessionHeader[],
  query: string,
): readonly SessionHeader[] => {
  const wanted = query.trim().toLowerCase()
  if (wanted === "") return headers

  return headers.filter(
    (one) =>
      one.id.toLowerCase().includes(wanted) || (one.title ?? "").toLowerCase().includes(wanted),
  )
}
