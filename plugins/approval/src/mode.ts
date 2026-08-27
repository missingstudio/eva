import { looksOnly, type ToolDecision } from "@missingstudio/eva-core"
import type { ToolKind } from "@missingstudio/eva-schema"
import { declare, readShape } from "@missingstudio/eva-sdk"

/**
 * The named permission modes, and what a mode decides.
 *
 * A mode is two things at once. It is **capability selection** — which tools
 * the agent is shown at all, which is a rebuild of the tool domain — and it is
 * a **mandate**, which is what it decides about a call it did select. The two
 * are the same table read two ways, so a mode cannot select a tool it would
 * always refuse.
 */

export type Mode = "read-only" | "supervised" | "autonomous" | "plan"

export interface ModeInfo {
  readonly id: Mode
  // What the mode tells the model it is there to do.
  readonly prompt: string
  // Which kinds are in the domain this mode builds.
  readonly reach: "everything" | "looking"
  // What the mode decides about a call that may change something.
  readonly changing: "refuse" | "ask" | "allow"
}

/**
 * `read-only` and `plan` select the same tools and differ in what they tell
 * the model to do with them: one is a restraint on Eva, the other is a task.
 * Two modes rather than one, because a person who asked for a plan has asked
 * for something and a person who asked for read-only has forbidden something.
 */
export const MODES: readonly ModeInfo[] = [
  {
    id: "read-only",
    prompt: "Read and search only. Nothing you do changes this working tree.",
    reach: "looking",
    changing: "refuse",
  },
  {
    id: "supervised",
    prompt: "Propose each change. A person approves anything that is not a read.",
    reach: "everything",
    changing: "ask",
  },
  {
    id: "autonomous",
    prompt: "Work to the end of the task. The rules and the sandbox are the limits.",
    reach: "everything",
    changing: "allow",
  },
  {
    id: "plan",
    prompt: "Read the tree and write a plan. Change nothing until a person asks.",
    reach: "looking",
    changing: "refuse",
  },
]

export const modeInfo = (id: string): ModeInfo | undefined => MODES.find((one) => one.id === id)

export const isMode = (id: string): id is Mode => modeInfo(id) !== undefined

// Whether a domain built to this reach holds a tool of this kind.
export const reaches = (reach: ModeInfo["reach"], kind: ToolKind): boolean =>
  reach === "everything" || looksOnly(kind)

/**
 * The widest reach of the modes in play, which is what the tool domain is
 * built to.
 *
 * A domain is process-wide and a mode is per Session, so the two cannot be the
 * same statement when two Sessions are open. The domain is what the model is
 * shown and the mandate is what runs, so the domain holds the widest live
 * mode's tools and each Session's own mandate refuses what that Session may
 * not run. Fail-closed sits at the gate, where it decides.
 */
export const widest = (modes: readonly ModeInfo[]): ModeInfo["reach"] =>
  modes.some((one) => one.reach === "everything") ? "everything" : "looking"

/**
 * What the mode decides about one call, or nothing when the mode stands aside.
 * A call that only looks is never a mode's business: every mode reads.
 */
export const mandateOf = (
  mode: ModeInfo,
  kind: ToolKind,
  name: string,
): ToolDecision | undefined => {
  if (looksOnly(kind)) return undefined
  switch (mode.changing) {
    case "allow":
      return undefined
    case "refuse":
      return {
        kind: "reject_always",
        reason: `${mode.id} mode runs no tool that changes anything, and ${name} does`,
      }
    case "ask":
      return { kind: "ask", question: `${name} may change something. Run it?` }
  }
}

/**
 * A per-tool override inside a mode. It narrows and never widens, so there is
 * no `allow`: a mode is what widens, and an override a person could write to
 * open a tool the mode closed would be the widening a repo profile must never
 * do.
 */
export type Override = "ask" | "deny"

export interface Approval {
  readonly mode: Mode
  // Keyed by the mode, then the tool name the model calls.
  readonly overrides: Readonly<Record<string, Readonly<Record<string, Override>>>>
  readonly faults: readonly string[]
}

/**
 * The mode a build runs under when config names none. Supervised, because a
 * build that reached for a default has not said it may work unattended.
 */
export const DEFAULT_MODE: Mode = "supervised"

// The default mode's own row, so a lookup of a mode is total.
export const DEFAULT_INFO: ModeInfo = MODES.find((one) => one.id === DEFAULT_MODE) as ModeInfo

export const APPROVAL_KEYS = declare({ approval: "mapping" })

const overridesIn = (
  value: unknown,
  at: string,
  faults: string[],
): Readonly<Record<string, Override>> => {
  const found = readShape(value, "mapping")
  if (found === undefined) {
    faults.push(`${at}: the overrides are a mapping of one tool name to one decision`)
    return {}
  }

  const read: Record<string, Override> = {}
  for (const [name, one] of Object.entries(found)) {
    if (one === "ask" || one === "deny") {
      read[name] = one
      continue
    }
    faults.push(
      one === "allow"
        ? `${at}.${name}: an override narrows a mode, and a mode is what widens`
        : `${at}.${name}: an override is ask or deny`,
    )
  }
  return read
}

/**
 * The `approval` key, read. Every fault is collected rather than thrown: a
 * gate that cannot read its own configuration denies every call, and the
 * person reads all of what is wrong at once.
 */
export const readApproval = (value: unknown): Approval => {
  const faults: string[] = []
  if (value === undefined || value === null) {
    return { mode: DEFAULT_MODE, overrides: {}, faults }
  }

  const found = readShape(value, "mapping")
  if (found === undefined) {
    return { mode: DEFAULT_MODE, overrides: {}, faults: ["approval: a mode is named in a mapping"] }
  }

  const named = found["mode"]
  const mode = named === undefined ? DEFAULT_MODE : readShape(named, "string")
  if (mode === undefined || !isMode(mode)) {
    faults.push(`approval.mode: no mode is named ${String(named)}`)
  }

  const overrides: Record<string, Readonly<Record<string, Override>>> = {}
  const modes = found["modes"]
  if (modes !== undefined) {
    const table = readShape(modes, "mapping")
    if (table === undefined) {
      faults.push("approval.modes: the modes are a mapping of one mode to its overrides")
    } else {
      for (const [name, one] of Object.entries(table)) {
        if (!isMode(name)) {
          faults.push(`approval.modes.${name}: no mode is named ${name}`)
          continue
        }
        const entry = readShape(one, "mapping")
        if (entry === undefined) {
          faults.push(`approval.modes.${name}: a mode's overrides are a mapping`)
          continue
        }
        if (entry["tools"] !== undefined) {
          overrides[name] = overridesIn(entry["tools"], `approval.modes.${name}.tools`, faults)
        }
      }
    }
  }

  return {
    mode: mode !== undefined && isMode(mode) ? mode : DEFAULT_MODE,
    overrides,
    faults,
  }
}

export const approvalOf = (config: Record<string, unknown>): Approval =>
  readApproval(config["approval"])
