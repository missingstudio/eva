import type { Reads } from "@missingstudio/eva-sdk"
import { misshapenKeys, suggestKey, unreadKeys } from "./keys.js"

/**
 * Something a run did not read, and why. An ignored file and a key nobody
 * understands are both degraded outcomes, and a degraded outcome is reported
 * rather than passed over in silence.
 *
 * It is data rather than a line of text, so the terminal, `eva config show`,
 * and a surface across a socket all report the same answer.
 */
export type Finding =
  | { readonly kind: "ignored"; readonly path: string }
  | { readonly kind: "untrusted"; readonly directory: string }
  | {
      readonly kind: "unread"
      readonly key: string
      readonly origin?: string
      // The known key a typo most likely meant.
      readonly meant?: string
      // Set when the key is an option under a plugin's own entry rather than
      // a top-level one.
      readonly plugin?: string
    }
  | {
      readonly kind: "misshapen"
      readonly key: string
      readonly wanted: string
      readonly origin?: string
      // The key that would have taken this value as written.
      readonly meant?: string
      readonly plugin?: string
    }
  // A plugin config resolved to that this build carries no implementation
  // for. It cannot load, and a plugin that never loaded is indistinguishable
  // from one that loaded and did nothing.
  | { readonly kind: "uncarried"; readonly id: string; readonly origin?: string }

/**
 * One resolved plugin entry, and what the plugin that would load says its
 * options are. An entry this build carries no implementation for has no
 * declaration to check against and is left out: it is already a Finding of
 * its own, and naming each of its options on top of that says nothing more.
 */
export interface ReviewedEntry {
  readonly id: string
  readonly options: Record<string, unknown>
  readonly takes: Reads
}

/**
 * What a review needs, and no more. The origin arrives as a question to ask
 * rather than a table to read, so this half never imports the kernel.
 */
export interface Reviewed {
  readonly raw: Record<string, unknown>
  readonly origin: (key: string) => string | undefined
  readonly directory: string
  readonly ignored: readonly string[]
  // Every key the plugins that would load declare they read.
  readonly reads: Reads
  /**
   * The resolved entries, for the options each one carries. Only the top
   * level used to be swept, so a plugin option written `maxTokns:` fell back
   * to the default in silence — the same mistake, one level down, reported
   * two different ways depending on where it was written.
   */
  readonly entries?: readonly ReviewedEntry[]
  // Resolved plugin ids this build carries no implementation for. Which ids
  // a build carries is the composition root's to know, so it arrives here.
  readonly uncarried?: readonly string[]
}

const said = (value: string | undefined, as: "origin" | "meant") =>
  value === undefined ? {} : { [as]: value }

/**
 * Everything the config reached nothing with: the files a grant would have
 * opened, the keys nothing reads, and the keys read in a shape nothing can.
 */
export const findings = (reviewed: Reviewed): readonly Finding[] => {
  const ignored: Finding[] = reviewed.ignored.map((path) => ({ kind: "ignored", path }))
  if (ignored.length > 0) ignored.push({ kind: "untrusted", directory: reviewed.directory })

  const unread: Finding[] = unreadKeys(reviewed.raw, reviewed.reads).map((key) => ({
    kind: "unread",
    key,
    ...said(reviewed.origin(key), "origin"),
    ...said(suggestKey(key, reviewed.reads), "meant"),
  }))

  const misshapen: Finding[] = misshapenKeys(reviewed.raw, reviewed.reads).map((found) => ({
    kind: "misshapen",
    key: found.key,
    wanted: found.wanted,
    ...said(reviewed.origin(found.key), "origin"),
    ...said(found.meant, "meant"),
  }))

  // The same two sweeps, over each entry's own options and against what that
  // plugin declares it takes. The file that named the plugins is the origin.
  const inEntries: Finding[] = (reviewed.entries ?? []).flatMap((entry) => {
    const where = said(reviewed.origin("plugins"), "origin")
    return [
      ...unreadKeys(entry.options, entry.takes).map(
        (key): Finding => ({
          kind: "unread",
          key,
          plugin: entry.id,
          ...where,
          ...said(suggestKey(key, entry.takes), "meant"),
        }),
      ),
      ...misshapenKeys(entry.options, entry.takes).map(
        (found): Finding => ({
          kind: "misshapen",
          key: found.key,
          wanted: found.wanted,
          plugin: entry.id,
          ...where,
          ...said(found.meant, "meant"),
        }),
      ),
    ]
  })

  const uncarried: Finding[] = (reviewed.uncarried ?? []).map((id) => ({
    kind: "uncarried",
    id,
    ...said(reviewed.origin("plugins"), "origin"),
  }))

  return [...ignored, ...unread, ...misshapen, ...inEntries, ...uncarried]
}
