import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { argvOf, type Approving } from "@missingstudio/eva-core"
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
 * Adds the rule to the file, and answers whether it was not already there.
 * Granting twice writes nothing, so a person may answer `allow_always` again
 * without collecting a second copy of their own rule.
 */
export const writeGrant = (path: string, rule: GrantedRule): boolean => {
  let held: unknown
  try {
    held = parse(readFileSync(path, "utf8"))
  } catch {
    held = undefined
  }

  const document = mappingIn(held)
  const policy = mappingIn(document["policy"])
  const rules = Array.isArray(policy["rules"]) ? [...(policy["rules"] as unknown[])] : []
  if (rules.some((one) => sameRule(one, rule))) return false

  rules.push(rule)
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
 * A call with no words is a call the rule language cannot grant: it grants
 * over the words a command would run, and a call that names a file instead is
 * either an ordinary change a mode is what widens, or a protected path that
 * settings may never pre-approve. So `allow_always` on one of those allows the
 * call and remembers nothing, and the person changes the mode instead.
 */
export const remembering =
  (asking: Approving, env: NodeJS.ProcessEnv = process.env): Approving =>
  (request, call) =>
    Effect.gen(function* () {
      const outcome = yield* asking(request, call)
      if (outcome.kind !== "allow_always") return outcome

      const words = argvOf(call.args)
      if (words !== undefined) {
        yield* Effect.sync(() =>
          writeGrant(
            configPath(env),
            grantedRule(words, `a person allowed this: ${request.toolCall.title}`),
          ),
        )
      }
      return outcome
    })
