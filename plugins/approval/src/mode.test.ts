import { describe, expect, it } from "vitest"
import {
  DEFAULT_MODE,
  mandateOf,
  modeInfo,
  MODES,
  reaches,
  readApproval,
  widest,
  type ModeInfo,
} from "./mode.js"

const mode = (id: string): ModeInfo => modeInfo(id) as ModeInfo

describe("the four modes", () => {
  it("are the four the roadmap names", () => {
    expect(MODES.map((one) => one.id)).toEqual(["read-only", "supervised", "autonomous", "plan"])
  })

  // Every mode reads. A mode that could not read would be a mode in which an
  // agent cannot start.
  it.each(MODES.map((one) => one.id))("reads in %s mode", (id) => {
    expect(reaches(mode(id).reach, "read")).toBe(true)
    expect(mandateOf(mode(id), "read", "read")).toBeUndefined()
  })

  it.each(["read-only", "plan"] as const)("reaches no changing tool in %s mode", (id) => {
    expect(reaches(mode(id).reach, "edit")).toBe(false)
    expect(reaches(mode(id).reach, "execute")).toBe(false)
  })

  // A mandate is what `reject_always` is for, so a mode's refusal is not a
  // refusal of this one call.
  it("refuses a changing call as a mandate in read-only mode", () => {
    expect(mandateOf(mode("read-only"), "edit", "edit")).toEqual({
      kind: "reject_always",
      reason: "read-only mode runs no tool that changes anything, and edit does",
    })
  })

  it("asks about a changing call in supervised mode", () => {
    expect(mandateOf(mode("supervised"), "execute", "bash")).toEqual({
      kind: "ask",
      question: "bash may change something. Run it?",
    })
  })

  it("stands aside in autonomous mode", () => {
    expect(mandateOf(mode("autonomous"), "edit", "edit")).toBeUndefined()
  })

  /**
   * A kind the list of looking kinds does not name may change something, so a
   * mode that reaches only what looks does not reach it. Failing closed is
   * what a gate does.
   */
  it("treats a kind it does not know as one that changes something", () => {
    expect(reaches(mode("read-only").reach, "other")).toBe(false)
    expect(mandateOf(mode("supervised"), "other", "acme")).toEqual({
      kind: "ask",
      question: "acme may change something. Run it?",
    })
  })
})

/**
 * A domain is process-wide and a mode is per Session. The domain is built to
 * the widest live mode, and each Session's mandate is what refuses — so the
 * strict side is at the gate, where it decides.
 */
describe("the reach of the modes in play", () => {
  it("is looking when every live mode only looks", () => {
    expect(widest([mode("read-only"), mode("plan")])).toBe("looking")
  })

  it("is everything as soon as one live mode reaches everything", () => {
    expect(widest([mode("read-only"), mode("autonomous")])).toBe("everything")
  })
})

describe("the approval key", () => {
  it("is supervised when config names nothing", () => {
    expect(readApproval(undefined)).toEqual({ mode: DEFAULT_MODE, overrides: {}, faults: [] })
  })

  it("names one of the four modes", () => {
    expect(readApproval({ mode: "autonomous" }).mode).toBe("autonomous")
  })

  // A gate that cannot read its own configuration denies every call, so a
  // mode nobody named is a fault rather than a quiet fallback.
  it("faults on a mode nothing names", () => {
    expect(readApproval({ mode: "yolo" }).faults).toEqual(["approval.mode: no mode is named yolo"])
  })

  it("reads a per-tool override inside a mode", () => {
    const read = readApproval({
      mode: "autonomous",
      modes: { autonomous: { tools: { bash: "ask", edit: "deny" } } },
    })

    expect(read.faults).toEqual([])
    expect(read.overrides["autonomous"]).toEqual({ bash: "ask", edit: "deny" })
  })

  /**
   * An override narrows. There is no `allow`, because a person who could open
   * a tool their mode closed from a config file is the widening a repo profile
   * must never do — and a value that quietly did nothing would be worse.
   */
  it("faults on an override that would widen a mode", () => {
    expect(readApproval({ modes: { supervised: { tools: { bash: "allow" } } } }).faults).toEqual([
      "approval.modes.supervised.tools.bash: an override narrows a mode, and a mode is what widens",
    ])
  })

  it("faults on overrides for a mode nothing names", () => {
    expect(readApproval({ modes: { yolo: { tools: {} } } }).faults).toEqual([
      "approval.modes.yolo: no mode is named yolo",
    ])
  })

  // Every fault at once, because a person reads all of what is wrong before
  // they edit the file.
  it("collects every fault rather than stopping at the first", () => {
    expect(
      readApproval({ mode: "yolo", modes: { supervised: { tools: { bash: "maybe" } } } }).faults,
    ).toHaveLength(2)
  })
})
