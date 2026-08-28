import { sessionID, type SessionID } from "@missingstudio/eva-schema"
import type { SessionHeader } from "@missingstudio/eva-core"
import { describe, expect, it } from "vitest"
import { filtered, grouped } from "./grouping.js"

/**
 * The rail's two pure functions, with the clock handed in.
 *
 * Nothing here reads `new Date()`. A grouping that read the clock for itself
 * would be a grouping nobody can test across a day boundary, and a day
 * boundary is the only place it can be wrong.
 */

const at = (id: string, updatedAt?: string): SessionHeader => ({
  id: sessionID(id) as SessionID,
  ...(updatedAt === undefined ? {} : { updatedAt }),
})

// A Tuesday, late morning, so a day back and a day forward are both inside
// the same month and neither is a weekend edge.
const NOW = new Date("2026-08-25T11:00:00.000Z")

const labels = (headers: readonly SessionHeader[], now = NOW): readonly string[] =>
  grouped(headers, now).map((group) => group.label)

const inside = (headers: readonly SessionHeader[], label: string, now = NOW): readonly string[] =>
  grouped(headers, now)
    .find((group) => group.label === label)
    ?.sessions.map((one) => one.id) ?? []

describe("the day groups", () => {
  it("puts each Session under the day its own updatedAt names", () => {
    const held = [
      at("ses_today", "2026-08-25T09:00:00.000Z"),
      at("ses_yesterday", "2026-08-24T09:00:00.000Z"),
      at("ses_week", "2026-08-21T09:00:00.000Z"),
      at("ses_month", "2026-08-10T09:00:00.000Z"),
      at("ses_older", "2026-04-02T09:00:00.000Z"),
    ]

    expect(labels(held)).toEqual(["Today", "Yesterday", "This week", "This month", "Older"])
    expect(inside(held, "Today")).toEqual(["ses_today"])
    expect(inside(held, "Older")).toEqual(["ses_older"])
  })

  // A group with nothing in it is not drawn. A label over no rows reads as a
  // day whose Sessions failed to load.
  it("draws no label over a group that holds nothing", () => {
    expect(labels([at("ses_one", "2026-08-25T09:00:00.000Z")])).toEqual(["Today"])
  })

  it("orders the newest first inside a group", () => {
    const held = [
      at("ses_early", "2026-08-25T02:00:00.000Z"),
      at("ses_late", "2026-08-25T10:30:00.000Z"),
      at("ses_middle", "2026-08-25T07:00:00.000Z"),
    ]

    expect(inside(held, "Today")).toEqual(["ses_late", "ses_middle", "ses_early"])
  })

  /**
   * The boundary the buckets exist to get right. Two Sessions a minute apart
   * across midnight are a day apart to a reader, and an elapsed-hours rule
   * would call them both today.
   */
  it("separates a minute before midnight from a minute after it", () => {
    const now = new Date("2026-08-25T00:05:00")
    const held = [at("ses_after", "2026-08-25T00:01:00"), at("ses_before", "2026-08-24T23:59:00")]

    expect(labels(held, now)).toEqual(["Today", "Yesterday"])
    expect(inside(held, "Today", now)).toEqual(["ses_after"])
    expect(inside(held, "Yesterday", now)).toEqual(["ses_before"])
  })

  // A month edge is a day like any other. Yesterday is the day before, not
  // the same number in the month before.
  it("reads the last day of a month as yesterday on the first of the next", () => {
    const now = new Date("2026-09-01T09:00:00")

    expect(labels([at("ses_one", "2026-08-31T22:00:00")], now)).toEqual(["Yesterday"])
  })

  // And a year edge, which is the same rule and the one a calendar arithmetic
  // that subtracts month numbers gets wrong.
  it("reads the last day of a year as yesterday on the first of the next", () => {
    const now = new Date("2027-01-01T09:00:00")

    expect(labels([at("ses_one", "2026-12-31T22:00:00")], now)).toEqual(["Yesterday"])
  })

  /**
   * A Session Eva has not heard from is still a Session a person can open, so
   * it is on the rail. It has no place in time, so it is at the end under a
   * label that says so rather than under a day the page guessed.
   */
  it("gathers the undated at the end, and never inside a day", () => {
    const held = [at("ses_undated"), at("ses_today", "2026-08-25T09:00:00.000Z")]

    expect(labels(held)).toEqual(["Today", "Undated"])
    expect(inside(held, "Undated")).toEqual(["ses_undated"])
  })

  // A stamp nothing can read places a Session nowhere in time, which is the
  // same thing as having none. Guessing a day from it would be worse.
  it("treats a stamp it cannot read as undated", () => {
    expect(labels([at("ses_bad", "the day before")])).toEqual(["Undated"])
  })

  /**
   * A clock that runs behind the machine that wrote the record leaves a
   * Session stamped in the future. It is the most recent thing there is, so it
   * reads as today — never as older than everything else.
   */
  it("reads a Session stamped ahead of the clock as today", () => {
    const held = [at("ses_ahead", "2026-08-26T09:00:00.000Z")]

    expect(labels(held)).toEqual(["Today"])
  })

  it("has nothing to say about a listing that holds nothing", () => {
    expect(grouped([], NOW)).toEqual([])
  })

  /**
   * Each group says when its Sessions moved, in its own precision, so a
   * drawing asks the group rather than reading its label back and deciding
   * for itself. An hour places today and yesterday; further back, an hour
   * says nothing and the day is what a reader wants — so two stamps an hour
   * apart read apart today, and read as one day further back.
   */
  it("says when a Session moved, by the hour today and by the day further back", () => {
    const today = grouped(
      [at("ses_nine", "2026-08-25T09:00:00.000Z"), at("ses_ten", "2026-08-25T10:00:00.000Z")],
      NOW,
    )[0]
    const apart = today?.sessions.map((one) => today.moved(one))
    expect(apart?.[0]).not.toBe("")
    expect(apart?.[0]).not.toBe(apart?.[1])

    const older = grouped(
      [
        at("ses_morning", "2026-04-02T09:00:00.000Z"),
        at("ses_evening", "2026-04-02T15:00:00.000Z"),
      ],
      NOW,
    )[0]
    const sameDay = older?.sessions.map((one) => older.moved(one))
    expect(sameDay?.[0]).not.toBe("")
    expect(sameDay?.[0]).toBe(sameDay?.[1])
  })

  // A Session the record does not place in time is said nowhere in time
  // either: the words are empty rather than guessed.
  it("says nothing for a Session it cannot place in time", () => {
    const undated = grouped([at("ses_undated")], NOW)[0]
    expect(undated?.moved(at("ses_undated"))).toBe("")
  })
})

/**
 * The filter is over the Headers the page already holds. It reaches no wire:
 * a field that searched the far side would be a second read of the listing,
 * and this one narrows what is already on the rail.
 */
describe("the filter", () => {
  const held = [
    { ...at("ses_one", "2026-08-25T09:00:00.000Z"), title: "rename UserSvc to UserService" },
    { ...at("ses_two", "2026-08-25T08:00:00.000Z"), title: "run the tests" },
    at("ses_three", "2026-08-25T07:00:00.000Z"),
  ]

  it("keeps every Session while nothing has been typed", () => {
    expect(filtered(held, "")).toEqual(held)
    expect(filtered(held, "   ")).toEqual(held)
  })

  it("keeps the Sessions whose title holds the words", () => {
    expect(filtered(held, "tests").map((one) => one.id)).toEqual(["ses_two"])
  })

  // The id is the other thing a person has to hand — it is what a terminal
  // printed and what a bug report carries.
  it("keeps a Session named by its id", () => {
    expect(filtered(held, "ses_three").map((one) => one.id)).toEqual(["ses_three"])
  })

  // A person types what they remember, not what the record capitalised.
  it("reads the query and the title without regard to case", () => {
    expect(filtered(held, "USERSVC").map((one) => one.id)).toEqual(["ses_one"])
  })

  it("keeps nothing when nothing matches", () => {
    expect(filtered(held, "no such Session")).toEqual([])
  })

  // The order the listing arrived in. Narrowing a list is not reordering it.
  it("keeps the order it was handed", () => {
    expect(filtered(held, "ses_").map((one) => one.id)).toEqual(["ses_one", "ses_two", "ses_three"])
  })
})
