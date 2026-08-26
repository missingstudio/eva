import { sessionID, type SessionID } from "@missingstudio/eva-schema"

/**
 * The spelling of a fresh identity, in one place. The kernel and a plugin
 * both mint them and a plugin may not import the kernel, so each had written
 * its own copy — character for character, and free to drift the moment
 * either changed.
 *
 * It reads randomness from the Web Crypto global, which Node and a browser
 * both hold, because a Session opens on either one.
 */

// Sixteen hex characters. Short enough to read in a trace, wide enough that
// a collision within one machine's traces is not a thing to plan for.
export const shortID = (): string => crypto.randomUUID().replaceAll("-", "").slice(0, 16)

/**
 * A fresh Session identity. Whatever opens a Session mints one — the store
 * when there is one, and the composition root when nothing fills the slot —
 * so the spelling belongs under both rather than beside either.
 *
 * It is time-ordered: twelve hex characters of epoch milliseconds, then
 * eight random. Sorting the ids sorts creation, which names a Session's
 * file, breaks the `list` tie, and derives a date shard — all for one line.
 * An older random id still parses, still resolves, and still folds.
 */
export const newSessionID = (): SessionID =>
  sessionID(`sess_${Date.now().toString(16).padStart(12, "0")}${shortID().slice(0, 8)}`)
