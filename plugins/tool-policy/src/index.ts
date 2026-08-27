import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { judge } from "./gate.js"
import { POLICY_KEYS, rulesOf, sayFault } from "./rules.js"

export * from "./gate.js"
export * from "./paths.js"
export * from "./rules.js"
export * from "./shell.js"

/**
 * The deterministic gate. It decides at `tool.execute.before`, which is a
 * deciding boundary — so a hook here that throws denies the call it was
 * deciding, because a gate that fails open because a plugin threw is not a
 * gate.
 *
 * It is never a model classifier. Every answer comes from the rule set and the
 * protected-path list, so the whole gate runs in `verify` with nothing to call
 * and nothing to key. An advisory hook may sit above this one and narrow what
 * it decided; nothing widens it, because the strictest decision wins.
 */
export const toolPolicy = define({
  id: "eva.tool.policy",
  reads: POLICY_KEYS.shapes,
  effect: Effect.fn("eva.tool.policy")(function* (ctx) {
    const set = rulesOf(yield* ctx.config)

    /**
     * A gate that cannot read its own rules is not a gate, so it denies every
     * call rather than running with the half of the rule set it could read — a
     * profile whose deny rule has a typo would otherwise go on allowing.
     * `eva policy check` is what finds this before a run does.
     */
    if (set.faults.length > 0) {
      const said = set.faults.map(sayFault).join("; ")
      yield* ctx.toolHooks["tool.execute.before"]((event) => {
        event.decide({
          kind: "reject_once",
          reason: `eva.tool.policy cannot read its rules — ${said}. Run eva policy check`,
        })
      })
      return
    }

    /**
     * The kind is the boundary's: the execution resolved this call's row and
     * the event carries what it is, so the gate judges the row that will run
     * and reads the domain no second time.
     */
    yield* ctx.toolHooks["tool.execute.before"]((event) => {
      const decision = judge(set.rules, { kind: event.kind, args: event.args.get() })
      if (decision !== undefined) event.decide(decision)
    })
  }),
})
