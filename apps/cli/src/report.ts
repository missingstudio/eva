import type { DomainMiss } from "@missingstudio/eva-core"
import type { Finding } from "@missingstudio/eva-config"
import type { ResolvedConfig } from "./run.js"
import type { World } from "./world.js"

/**
 * One finding, as one line at a terminal. The finding decides what is wrong;
 * this decides only how a person reads it, so another surface may say the
 * same thing its own way.
 */
export const say = (finding: Finding): string => {
  if (finding.kind === "ignored") {
    return `eva: not reading ${finding.path}, because this directory is not trusted\n`
  }
  if (finding.kind === "untrusted") {
    return `eva: run \`eva trust\` in ${finding.directory} to read it\n`
  }

  const where = finding.origin === undefined ? "" : ` (${finding.origin})`
  if (finding.kind === "uncarried") {
    return `eva: no plugin named "${finding.id}" is in this build${where}\n`
  }

  const meant = finding.meant === undefined ? "" : `, did you mean "${finding.meant}"?`
  // A key under a plugin's own entry says whose, because the same name may be
  // an option of one plugin and nothing at all to another.
  const under = finding.plugin === undefined ? "" : ` in ${finding.plugin}'s options`
  return finding.kind === "unread"
    ? `eva: nothing reads "${finding.key}"${under}${meant}${where}\n`
    : `eva: "${finding.key}"${under} wants ${finding.wanted}, so nothing read it${meant}${where}\n`
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
  `eva: ${miss.owner ?? "something"} edited ${domain} "${miss.id}", and nothing had registered it\n`

// A slot eviction, as one line: a displaced filler did work that now has
// no effect, so the displacement is named.
export const sayEvicted = (slot: string, by: string, evicted: string): string =>
  `eva: ${slot} now answers from ${by}; ${evicted} filled it first\n`
