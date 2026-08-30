import type { PermissionOutcome, PermissionRequest } from "@missingstudio/eva-acp"
import type { SessionID, ToolKind } from "@missingstudio/eva-schema"
import type { Effect } from "effect"
import type { Edit, Hunk } from "./contracts.js"
import type { FrontendAnswer } from "./session-api.js"

/**
 * The words a gate reasons in: what one call is, what may be decided about it,
 * and the readings of a call's arguments that more than one gate needs.
 *
 * It is here rather than beside the execution because the audiences differ. A
 * gate plugin judges a call and never runs one, and the tool runtime runs a
 * call and decides nothing — so a gate that had to import the runner to reach
 * the word `ask` was learning a scheduler to ask a question. Everything here
 * is data and pure functions; nothing in this file runs a tool.
 *
 * `editOf` is here for one reason: two gates read the same argument. The write
 * tool runs an Edit and the approval gate previews it, so two readers of one
 * argument would be two answers to keep in step. The words a call would run
 * are read the same way and for the same reason, in
 * [`invocation.ts`](./invocation.ts) beside the splitter they need.
 */

/**
 * ACP's permission types, re-exported: `Approving` names both in its own
 * signature, so anything that fills or calls the gate reaches them from here
 * rather than depending on the protocol package for two type names.
 */
export type { PermissionOutcome, PermissionRequest }

export interface ToolCall {
  // The call id, and the join key of every record of the call. Not an EventID.
  readonly id: string
  readonly name: string
  readonly args: unknown
  readonly session: SessionID
}

/**
 * What a hook at `tool.execute.before` may decide. These are ACP's four
 * options plus the question, so a foreign harness plugs into this gate rather
 * than getting one of its own.
 *
 * `ask` is not a final answer: a gate that can reach a person resolves it
 * into one of the other four, and a call that reaches the tool still holding
 * an `ask` is denied — a permission request with nobody to answer it is a
 * denial.
 */
export type ToolDecision =
  | { readonly kind: "allow_once" }
  | { readonly kind: "allow_always" }
  | { readonly kind: "reject_once"; readonly reason: string }
  | { readonly kind: "reject_always"; readonly reason: string }
  | { readonly kind: "ask"; readonly question: string }

// What the deciding boundary settled: the arguments its hooks left, and the
// strictest decision any of them made.
export interface Decided {
  readonly args: unknown
  readonly decision?: ToolDecision
}

/**
 * How restrictive each decision is. `ask` outranks both allows because a call
 * nobody has answered for does not run, and a repo profile may therefore
 * narrow a mandate and never widen it.
 */
const STRICTNESS: Record<ToolDecision["kind"], number> = {
  reject_always: 4,
  reject_once: 3,
  ask: 2,
  allow_once: 1,
  allow_always: 0,
}

/**
 * The strictest decision the boundary reached, or nothing when no hook
 * decided — which allows, because a hook nobody registered is a no-op and not
 * a missing feature. A tie keeps the earlier decision, so the reason that
 * reaches the model is the first hook's.
 */
export const strictest = (decisions: readonly ToolDecision[]): ToolDecision | undefined =>
  decisions.reduce<ToolDecision | undefined>(
    (held, one) =>
      held === undefined || STRICTNESS[one.kind] > STRICTNESS[held.kind] ? one : held,
    undefined,
  )

/**
 * What the hooks at a deciding boundary left: what they decided, what they
 * stated as a baseline, and the hook that died if one did.
 */
export interface Settling {
  readonly decisions: readonly ToolDecision[]
  readonly baselines: readonly ToolDecision[]
  // A hook that dies at a deciding boundary is a denial, because a gate that
  // fails open because a plugin threw is not a gate.
  readonly failure?: { readonly hook: string; readonly owner: string }
}

/**
 * What one deciding boundary settled, or nothing when it settled nothing and
 * the call runs.
 *
 * The whole precedence is here rather than at the caller that gathers the
 * hooks. Every driver of the boundary settles the same way — the Session API
 * today, and the Agent Client Protocol client half later — and a precedence
 * spelled at each of them is a precedence to keep in step.
 *
 * A hook that died joins the decisions rather than replacing them, so a
 * stricter decision an earlier hook made still carries its own reason. A
 * baseline is read only when nothing decided at all: specific standing
 * authority — a rule a person wrote — is never asked about again, and a mode
 * that supervises still asks about everything no rule named.
 */
export const settled = ({ decisions, baselines, failure }: Settling): ToolDecision | undefined => {
  const decided =
    failure === undefined
      ? decisions
      : [
          ...decisions,
          {
            kind: "reject_once",
            reason: `the ${failure.hook} hook of ${failure.owner} failed`,
          } as const,
        ]
  return strictest(decided) ?? strictest(baselines)
}

/**
 * The two ways an `ask` ends with no answer, said in one place because they
 * are two different facts that once shared a sentence.
 *
 * `unaskable` is a build with nothing that can reach a person: the `ask`
 * arrives at the tool still an `ask`, and a permission request with nobody to
 * answer it is a denial. `unanswered` is a person who was asked and named none
 * of the four options — they cancelled, or they typed something else. Both
 * deny the call, and a Trace says which happened.
 */
export const unaskable = (question: string): string => `nobody could be asked: ${question}`

export const unanswered = (question: string): string => `nobody answered: ${question}`

/**
 * The options a person is offered, and the only ones. ACP carries an option
 * list per request because a foreign agent may offer a subset; Eva's gate
 * offers all four of them every time, so the list is a constant here rather
 * than a field on the request — a request that carried it would carry the
 * same four words on every ask, and a surface would have two places to read
 * the labels from.
 *
 * `optionId` is the kind, because the answer names an option by id and the
 * gate turns that id back into an outcome. Two spellings of one option would
 * be a table to keep in step.
 */
export const PERMISSION_OPTIONS: PermissionRequest["options"] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject_once", name: "Reject once", kind: "reject_once" },
  { optionId: "reject_always", name: "Reject always", kind: "reject_always" },
]

/**
 * The option this text names, or nothing. It reads an `optionId` and the
 * human name, so a surface that offers the four as words needs no table of
 * its own.
 */
export const optionFor = (text: string): PermissionOutcome["kind"] | undefined => {
  const wanted = text.trim().toLowerCase()
  return PERMISSION_OPTIONS.find(
    (one) => one.optionId.toLowerCase() === wanted || one.name.toLowerCase() === wanted,
  )?.kind
}

/**
 * The line a person typed, as the answer it is. A permission request offers
 * four options a person may type, so the line is read for one first and a
 * line that names none goes as the text it is. Every other request takes the
 * line whole: a question answered with the word "allow" is that word, and a
 * door that read it as an option would answer a question nobody asked.
 *
 * Both doors call this. The rule is a fact of the request and the line, so
 * one place decides it — a terminal and a page that each read a line their
 * own way are two products.
 */
export const answerFor = (kind: "permission" | "question", line: string): FrontendAnswer => {
  const option = kind === "permission" ? optionFor(line) : undefined
  return option === undefined
    ? { kind: "text", text: line }
    : { kind: "permission", optionId: option }
}

/**
 * How an `ask` becomes an answer. This is `HarnessClient.requestPermission`
 * with the call beside it: the ACP request names the call and not its
 * arguments, and remembering an answer that says "always" is written over the
 * words the call would run.
 *
 * Absent, an `ask` is a denial. A permission request with nobody to answer it
 * is a denial, and a surface that takes no input has nobody behind it.
 */
export type Approving = (
  request: PermissionRequest,
  call: ToolCall,
) => Effect.Effect<PermissionOutcome>

/**
 * The tool kinds that only look. Everything else may change something, and a
 * kind this list does not name is one of those — failing closed is what a
 * gate does.
 *
 * Two gates ask the same question: the deterministic one decides whether a
 * protected path in the arguments is a write, and a permission mode decides
 * which tools it reaches at all. Two lists would be one list to keep in step.
 */
export const LOOKS_ONLY: readonly ToolKind[] = ["read", "search", "think", "fetch"]

export const looksOnly = (kind: ToolKind): boolean => LOOKS_ONLY.includes(kind)

/**
 * What a call that names an Edit is asked to do: the Edit, and whether the
 * call stops at the Preview.
 */
export interface EditInput extends Edit {
  // A dry run: the Preview is answered and nothing is written.
  readonly dryRun?: boolean
}

const hunkOf = (found: unknown): Hunk | undefined => {
  if (typeof found !== "object" || found === null || Array.isArray(found)) return undefined
  const { find, replace } = found as Record<string, unknown>
  return typeof find === "string" && typeof replace === "string" ? { find, replace } : undefined
}

// Every Hunk, or nothing when one of them is not a Hunk. A part of an Edit is
// not an Edit: the applier lands all of them or none.
const hunksOf = (listed: readonly unknown[]): readonly Hunk[] | undefined => {
  const hunks: Hunk[] = []
  for (const one of listed) {
    const hunk = hunkOf(one)
    if (hunk === undefined) return undefined
    hunks.push(hunk)
  }
  return hunks
}

/**
 * The Edit a call's arguments name, or nothing when they name none. It reads
 * the shape and never the tool's name, so a second write tool that takes an
 * Edit is read the same way — and a dry run is carried, because a question
 * that dropped it would misstate the call it is about.
 */
export const editOf = (args: unknown): EditInput | undefined => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined
  const asked = args as Record<string, unknown>
  const path = asked["path"]
  const listed = asked["hunks"]
  if (typeof path !== "string" || path === "" || !Array.isArray(listed)) return undefined

  const hunks = hunksOf(listed)
  if (hunks === undefined || hunks.length === 0) return undefined

  return { path, hunks, ...(asked["dryRun"] === true ? { dryRun: true } : {}) }
}
