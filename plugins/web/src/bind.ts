import { isIPv4 } from "node:net"

// A local page binds to loopback. The port is the one the roadmap's own
// demo block prints, so what a reader typed is what the demo showed.
export const DEFAULT_HOST = "127.0.0.1"
export const DEFAULT_PORT = 7777

export interface Bind {
  readonly host: string
  readonly port: number
}

// The names that mean this machine and nothing else. `localhost` is here
// because a person types it, and `::1` because it is the IPv6 loopback.
const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "::1"])

// The prefix that writes an IPv4 address in the other family's spelling.
const MAPPED = "::ffff:"

/**
 * Whether a bind reaches this machine only. The whole of 127.0.0.0/8 is
 * loopback, so 127.0.0.2 is this machine as much as 127.0.0.1 is. A spelling
 * this does not know is remote: `0.0.0.0`, `::` and an empty host are every
 * interface the machine has, and this exists to refuse them.
 */
export const isLocal = (host: string): boolean => {
  const asked = host.trim().toLowerCase()
  const address = asked.startsWith(MAPPED) ? asked.slice(MAPPED.length) : asked
  return LOOPBACK.has(address) || (isIPv4(address) && address.startsWith("127."))
}

// The refusal, as a person reads it. It says what the rule is and what to do
// instead. It names no stage and no token plan: a roadmap is ours, and a
// person at a refused bind can act on neither.
const BIND_REFUSED = `a page on a non-local address is not authenticated, so it is refused; bind ${DEFAULT_HOST} instead`

/**
 * Why this bind is refused, or nothing when it is local. A remote page has no
 * way to authenticate a visitor, so a non-local bind is refused rather than
 * served unauthenticated. The posture opens no door either: `hosted` is a
 * tenancy and not a token.
 *
 * The rule is this plugin's and the exit code is the app's. `SurfaceInfo.start`
 * has `never` in its error channel, so two callers gate it: `apps/cli` before
 * it boots, and `serveWeb` before it creates a server.
 */
export const refusal = (host: string = DEFAULT_HOST): string | undefined =>
  isLocal(host) ? undefined : BIND_REFUSED
