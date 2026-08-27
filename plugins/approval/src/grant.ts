import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { grantableWords, type Approving } from "@missingstudio/eva-core"
import { configPath } from "@missingstudio/eva-core/local"
import { Effect } from "effect"
import { parse, stringify } from "yaml"

/**
 * What `allow_always` writes down.
 *
 * The four options separate the decision from how long it persists, so
 * `allow_always` has to reach disk in a form a later Run reads back. That form
 * already exists: `policy.rules` is the rule language the deterministic gate
 * reads, and a grant is an `allow` rule over the words the call would run. So
 * the next Run's gate answers `allow_once` from the rule and the person is
 * never asked again — which is also why the mode consults that gate before it
 * asks.
 *
 * The grant goes in the person's own config file and never in the repository's.
 * A grant a person gave belongs beside their own settings, for the reason the
 * trust list does: a repository that shipped a file granting itself permission
 * is a repository making a claim about itself.
 */

// One rule as the profile holds it: a decision against a list of positions.
interface GrantedRule {
  readonly allow: readonly (readonly string[])[]
  readonly why: string
}

/**
 * The rule that grants these words. Each word becomes a position of one, so
 * the rule matches this command and the arguments after it — which is what a
 * prefix rule means and what the person was asked about.
 *
 * The words are the ones the gate judged, and never the argument list as a
 * caller spelled it. A person asked about `bash -c "git status"` was asked
 * about `git status`, so that is what the rule names — a rule over the three
 * words `bash`, `-c` and the line would be well formed and could never fire.
 */
export const grantedRule = (words: readonly string[], said: string): GrantedRule => ({
  allow: words.map((word) => [word]),
  why: said,
})

const mappingIn = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const sameRule = (one: unknown, rule: GrantedRule): boolean => {
  const found = mappingIn(one)["allow"]
  return (
    Array.isArray(found) &&
    JSON.stringify(found) === JSON.stringify(rule.allow.map((one) => [...one]))
  )
}

/**
 * Adds the rules to the file, and answers whether any of them was not already
 * there. Granting twice writes nothing, so a person may answer `allow_always`
 * again without collecting a second copy of their own rule.
 *
 * One answer writes every rule it granted in one act, because one answer is
 * about one call: a chain the person allowed runs each of its Invocations, so
 * a file holding half of them would ask again about the other half.
 */
export const writeGrant = (path: string, granted: readonly GrantedRule[]): boolean => {
  let held: unknown
  try {
    held = parse(readFileSync(path, "utf8"))
  } catch {
    held = undefined
  }

  const document = mappingIn(held)
  const policy = mappingIn(document["policy"])
  const rules = Array.isArray(policy["rules"]) ? [...(policy["rules"] as unknown[])] : []
  const fresh = granted.filter((rule) => !rules.some((one) => sameRule(one, rule)))
  if (fresh.length === 0) return false

  rules.push(...fresh)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringify({ ...document, policy: { ...policy, rules } }))
  return true
}

/**
 * An asker that remembers an answer saying "always". It wraps the asker that
 * reaches a person, because the surface that holds the person is boot's and
 * the rule language is this plugin's — the composition root is where the two
 * meet.
 *
 * A call with no words to grant is a call the rule language cannot grant. A
 * call that names a file instead of a command is one: it is either an ordinary
 * change a mode is what widens, or a protected path that settings may never
 * pre-approve. An Opaque Invocation is the other: the words that would run are
 * not the words anybody read, so no rule over them could fire. So
 * `allow_always` on either allows the call and remembers nothing, and the
 * person changes the mode instead.
 */
export const remembering =
  (asking: Approving, env: NodeJS.ProcessEnv = process.env): Approving =>
  (request, call) =>
    Effect.gen(function* () {
      const outcome = yield* asking(request, call)
      if (outcome.kind !== "allow_always") return outcome

      const granted = grantableWords(call.args)
      if (granted !== undefined) {
        const said = `a person allowed this: ${request.toolCall.title}`
        yield* Effect.sync(() =>
          writeGrant(
            configPath(env),
            granted.map((words) => grantedRule(words, said)),
          ),
        )
      }
      return outcome
    })
