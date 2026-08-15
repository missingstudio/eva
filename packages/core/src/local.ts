import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { sessionID, type SessionID } from "@missingstudio/eva-schema"

/**
 * What a module needs from the machine it runs on, in one place. The kernel
 * and a plugin both need these and a plugin may not import the kernel, so
 * each had written its own copy — character for character, and free to drift
 * the moment either changed.
 */

/**
 * A path as written, made absolute. `~/` is the home directory, because a
 * person writes a config path that way and `resolve` does not expand it.
 */
export const expand = (path: string): string =>
  path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path)

// Sixteen hex characters. Short enough to read in a trace, wide enough that
// a collision within one machine's traces is not a thing to plan for.
export const shortID = (): string => randomUUID().replaceAll("-", "").slice(0, 16)

/**
 * A fresh Session identity. Whatever opens a Session mints one — the store
 * when there is one, and the composition root when nothing fills the slot —
 * so the spelling belongs under both rather than beside either.
 */
export const newSessionID = (): SessionID => sessionID(`sess_${shortID()}`)
