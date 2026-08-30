import type { IntegrationInfo, KeymapInfo } from "@missingstudio/eva-sdk"
import { canonical, conflicts } from "@missingstudio/eva-tui-core"

/**
 * What the person has to read before the first fold.
 *
 * Four facts reach a person here and nowhere else: what went wrong on the way
 * to this surface, what a row beside it has to say, that a Run cannot reach a
 * model, and that a key they are about to press does nothing. Every one of
 * them is a degraded outcome, and a surface that passed over them would open
 * a screen that looks well and is not.
 *
 * It is a fold and not a step of starting, so it is proved without a
 * renderer, a keymap Domain or a Session. A sentence is what a person acts
 * on, and a sentence nobody can pin is one that drifts.
 */

/**
 * A provider with no key, as one actionable line. It names the variable to
 * export, because "not connected" is a state and not a step, and it names the
 * endpoints that need no key at all, because that is the other way out.
 */
export const sayNoCredential = (provider: string, variable: string): string =>
  `no key for ${provider}, so a prompt cannot run: export ${variable}, or name another endpoint — Ollama, vLLM, a gateway — in config`

/**
 * The key this Session would need and does not have, or nothing.
 *
 * The provider is the Session's own, so a run against an endpoint that needs
 * no key is told nothing: a provider that projects no `api_key` row wants no
 * variable, and a warning about one it does not read is noise a person learns
 * to pass over.
 */
export const missingCredential = (
  provider: string,
  rows: readonly IntegrationInfo[],
): string | undefined => {
  const named = rows.filter((row) => row.provider === provider)
  if (named.some((row) => row.connected)) return undefined
  const variable = named.find((row) => row.variable !== undefined)?.variable
  return variable === undefined ? undefined : sayNoCredential(provider, variable)
}

/**
 * A binding that cannot fire and a key bound twice, each as one line. This is
 * the one place rows collapse into a keymap, so it is the one place that can
 * ask — a row nobody swept is a key a person presses for nothing.
 */
export const sayKeymap = (rows: readonly KeymapInfo[]): readonly string[] => [
  ...rows
    .filter((row) => canonical(row.binding) === undefined)
    .map((row) => `key binding ${row.id} names no key this surface knows: ${row.binding}`),
  ...conflicts(rows).map(
    (one) => `${one.binding} is bound twice (${one.ids.join(", ")}); the last one wins`,
  ),
]

/**
 * What the surface says before the first fold, in the order a person reads
 * it: what happened on the way here first, then what this Session cannot do,
 * then what the keyboard will not do.
 *
 * The credential is absent rather than empty when nothing asked for one — an
 * attached terminal is not asked at all, because the credentials that decide
 * a Run are the serving process's and this process's say nothing about them.
 */
export const noticesOf = (from: {
  readonly said?: readonly string[]
  readonly credential?: string
  readonly keymap?: readonly KeymapInfo[]
}): readonly string[] => [
  ...(from.said ?? []),
  ...(from.credential === undefined ? [] : [from.credential]),
  ...sayKeymap(from.keymap ?? []),
]
