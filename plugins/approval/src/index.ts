import { recordRun } from "@missingstudio/eva-core"
import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import {
  APPROVAL_KEYS,
  approvalOf,
  DEFAULT_INFO,
  mandateOf,
  modeInfo,
  MODES,
  reaches,
  widest,
  type Mode,
  type ModeInfo,
} from "./mode.js"
import { previewed } from "./preview.js"

export * from "./grant.js"
export * from "./mode.js"
export * from "./preview.js"

// The slash command a person names a mode with.
export const MODE_COMMAND = "mode"

/**
 * Named permission modes, and the mandate half of the four-option gate.
 *
 * A mode is capability selection plus a mandate. Selection rebuilds the tool
 * domain, so the agent sees a different domain rather than a filtered one —
 * a filter at call time is a list the model was shown and then refused from,
 * and a rebuild is a list that never held the row. The mandate is a decision
 * at `tool.execute.before`, beside the deterministic gate's.
 *
 * It narrows and never widens, and that is a property of the boundary rather
 * than a check here: every decision at `tool.execute.before` is collected and
 * the strictest wins, so an `allow` rule in a repo profile can never beat a
 * mode's `reject_always`, and an override may only be `ask` or `deny`.
 */
export const approval = define({
  id: "eva.approval",
  reads: APPROVAL_KEYS.shapes,
  effect: Effect.fn("eva.approval")(function* (ctx) {
    const read = approvalOf(yield* ctx.config)

    /**
     * A gate that cannot read its own configuration is not a gate, so it
     * denies every call rather than running under a mode nobody named. The
     * same rule the deterministic gate follows, for the same reason.
     */
    if (read.faults.length > 0) {
      const said = read.faults.join("; ")
      yield* ctx.toolHooks["tool.execute.before"]((event) => {
        event.decide({
          kind: "reject_once",
          reason: `eva.approval cannot read its modes — ${said}`,
        })
      })
      return
    }

    /**
     * Which mode each Session runs under. A mode is per Session because a
     * Session is what a person changes; the default is what a Session that
     * has never been named runs under.
     */
    const sessions = new Map<string, Mode>()
    const modeFor = (session: string): ModeInfo =>
      modeInfo(sessions.get(session) ?? read.mode) ?? DEFAULT_INFO

    /**
     * The modes in play: the ones Sessions have named, or the default while no
     * Session has named one. A Session that never named a mode runs under the
     * default, and the tools it is shown may therefore be narrower than its
     * mandate — which is the fail-closed direction, and the only one worth
     * being wrong in.
     */
    const live = (): readonly ModeInfo[] =>
      sessions.size === 0 ? [modeFor("")] : [...sessions.keys()].map((session) => modeFor(session))

    /**
     * Capability selection. The transform is registered once and replayed on
     * every rebuild, so it reads the modes in play at replay time — which is
     * how `/mode read-only` rebuilds the domain with no second registration.
     *
     * It stays a pure edit of the draft: the read is the mode a Session has
     * named, and nothing outside the draft changes here. Reading it at replay
     * time is safe because a rebuild is serialized and `/mode` writes the map
     * before it asks for one, so every replay sees one settled set — and a
     * rebuild some other plugin asked for is answered with the modes as they
     * stand, which is the only answer this transform owes.
     */
    yield* ctx.tool.transform((draft) => {
      const reach = widest(live())
      for (const row of draft.list()) if (!reaches(reach, row.kind)) draft.remove(row.id)
    })

    /**
     * One agent row per mode. A mode is an agent definition — a named thing
     * with a prompt and a reach — so this is where a mode is published, and
     * `/mode` lists what the rows say rather than what this file says. The
     * `tools` field is left empty on purpose: a mode selects by what a tool
     * does and not by whether somebody listed its name, and a name list
     * beside the rule would go stale the moment a tool loads.
     */
    yield* ctx.agent.transform((draft) => {
      for (const mode of MODES)
        draft.set({ ...draft.get(mode.id), id: mode.id, prompt: mode.prompt })
    })

    /**
     * What a preview is resolved over. Both are slot reads and never values,
     * so a question is drawn against whatever fills the slots at the moment a
     * person is asked.
     */
    const ground = { files: ctx.slot.fileSystem.peek, applier: ctx.slot.diffApplier.peek }

    /**
     * The mandate. The kind is the boundary's: the execution resolved this
     * call's row and the event carries what it is, so the mandate judges the
     * row that will run and reads the domain no second time.
     */
    yield* ctx.toolHooks["tool.execute.before"]((event) =>
      Effect.gen(function* () {
        const mode = modeFor(event.session)
        const override = read.overrides[mode.id]?.[event.name]

        if (override === "deny") {
          event.decide({
            kind: "reject_always",
            reason: `${event.name} is denied in ${mode.id} mode`,
          })
          return
        }

        const wanted =
          override === "ask"
            ? ({
                kind: "ask",
                question: `${event.name} is asked about in ${mode.id} mode. Run it?`,
              } as const)
            : mandateOf(mode, event.kind, event.name)
        if (wanted === undefined) return

        /**
         * A mandate decides; supervision is a baseline. So a rule a person
         * wrote is never asked about again — which is what makes an
         * `allow_always` written into the profile stop the asking — and a
         * mandate still outranks a rule that would widen it, because the
         * strictest decision wins.
         *
         * A question about a write shows the write. The arguments are the
         * Edit, so the preview is resolved here from the two slots and the
         * tool is asked nothing — a person answers about a change rather than
         * about a tool's name.
         */
        if (wanted.kind !== "ask") {
          event.decide(wanted)
          return
        }
        const question = yield* previewed(ground, event.name, event.args.get())
        event.otherwise(question === undefined ? wanted : { ...wanted, question })
      }),
    )

    /**
     * `/mode read-only` — the person's door. It rebuilds the tool domain and
     * records the change, so the mode a Run worked under is a fact of the
     * Trace and not only a change in behaviour.
     */
    yield* ctx.command.transform((draft) => {
      draft.set({
        ...draft.get(MODE_COMMAND),
        id: MODE_COMMAND,
        description: "names the permission mode this Session runs under",
        argumentHint: "mode",
        run: Effect.fn("eva.approval.mode")(function* (command) {
          const rows = (yield* ctx.agent.get).filter((row) => modeInfo(row.id) !== undefined)
          const named = command.argument
          if (named === undefined) {
            command.write(`mode: ${modeFor(command.session).id}`)
            for (const row of rows) command.write(`  ${row.id}  ${row.prompt ?? ""}`)
            return
          }

          const next = modeInfo(named)
          if (next === undefined) {
            command.write(`no mode is named ${named}: ${rows.map((row) => row.id).join(", ")}`)
            return
          }

          sessions.set(command.session, next.id)
          // The domain the agent sees is rebuilt, which publishes
          // `tool.updated` by itself. There is no second broadcast for a mode.
          yield* ctx.tool.reload

          // A mode a person named is a whole Run: it opens with the line they
          // typed and closes with a Claim, so `/mode` is on the Trace the same
          // way every other Run is.
          yield* recordRun(yield* ctx.slot.recorder.peek, command.session, [
            { kind: "started", intent: `/${MODE_COMMAND} ${next.id}` },
            { kind: "mode", mode: next.id, reason: "a person named it" },
            { kind: "finished", claim: { result: "done" } },
          ])
          command.write(`mode: ${next.id}`)
        }),
      })
    })
  }),
})
