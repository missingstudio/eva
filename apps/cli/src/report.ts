import type { DomainMiss } from "@missingstudio/eva-core"
import type { Finding } from "@missingstudio/eva-config"
import type { ResolvedConfig } from "./run.js"
import type { World } from "./world.js"

// The one prefix. Every line this app says to a person begins with it, so a
// reader tells Eva speaking from a crash without reading the words.
export const PREFIX = "eva: "

/**
 * One thing Eva says, in the one shape.
 *
 * What happened comes first, why when it is not obvious, and the next step
 * when there is one. A refusal names the rule that declined it in `what`,
 * because a person who is told only "no" has been told nothing.
 */
export interface Said {
  readonly what: string
  readonly why?: string
  readonly next?: string
}

/**
 * A message, as a person reads it. The first line carries the prefix and
 * every line after it is indented under the prefix, so three sentences read
 * as one message and not as three faults.
 *
 * It returns no trailing newline: a writer that adds one adds one, and
 * `command.error` adds its own.
 */
export const speak = (said: Said): string =>
  [said.what, said.why, said.next]
    .filter((line): line is string => line !== undefined)
    .flatMap((line) => line.split("\n"))
    .map((line, at) => (at === 0 ? `${PREFIX}${line}` : `${" ".repeat(PREFIX.length)}${line}`))
    .join("\n")

/**
 * One finding, as one line at a terminal. The finding decides what is wrong;
 * this decides only how a person reads it, so another surface may say the
 * same thing its own way.
 */
export const say = (finding: Finding): string => {
  const said = (what: string): string => `${speak({ what })}\n`

  if (finding.kind === "ignored") {
    return said(`not reading ${finding.path}, because this directory is not trusted`)
  }
  if (finding.kind === "untrusted") {
    return said(`run \`eva trust\` in ${finding.directory} to read it`)
  }

  const where = finding.origin === undefined ? "" : ` (${finding.origin})`
  if (finding.kind === "uncarried") {
    return said(`no plugin named "${finding.id}" is in this build${where}`)
  }

  const meant = finding.meant === undefined ? "" : `, did you mean "${finding.meant}"?`
  // A key under a plugin's own entry says whose, because the same name may be
  // an option of one plugin and nothing at all to another.
  const under = finding.plugin === undefined ? "" : ` in ${finding.plugin}'s options`
  return finding.kind === "unread"
    ? said(`nothing reads "${finding.key}"${under}${meant}${where}`)
    : said(`"${finding.key}"${under} wants ${finding.wanted}, so nothing read it${meant}${where}`)
}

// What a run did not read, said once, before it does anything else.
export const report = (settled: ResolvedConfig, world: World): void => {
  for (const finding of settled.findings) world.err(say(finding))
}

/**
 * An edit that reached no row, as one line. The kernel counts these and the
 * broadcast carries them; this decides only how a person reads one.
 */
export const sayMiss = (domain: string, miss: DomainMiss): string =>
  `${speak({
    what: `${miss.owner ?? "something"} edited ${domain} "${miss.id}", and nothing had registered it`,
  })}\n`

// A slot eviction, as one line: a displaced filler did work that now has
// no effect, so the displacement is named.
export const sayEvicted = (slot: string, by: string, evicted: string): string =>
  `${speak({ what: `${slot} now answers from ${by}; ${evicted} filled it first` })}\n`

// What a thrown value says, without the class name a stringified Error
// carries. A reader needs the sentence, not the constructor.
export const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * A plugin that did not load, as one message. The kernel rolls the load back
 * and the run goes on without it, so this names which one is absent and why:
 * a degraded run nobody was told about is the silence this ends.
 */
export const sayFailed = (id: string, cause: unknown, hook?: string): string =>
  `${speak({
    what:
      hook === undefined
        ? `${id} did not load, and this run goes on without it`
        : `${id} failed at ${hook}, and this run goes on without it`,
    why: reasonOf(cause),
  })}\n`
