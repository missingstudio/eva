/**
 * Where the page's own routes are. The router names a parameter with `$` and
 * a link needs a value in its place, so both spellings live here: two
 * spellings of one path in two files is one that moves without the other.
 */
export const SESSION_ROUTE = "/sessions/$session"

export const sessionHref = (session: string): string =>
  SESSION_ROUTE.replace("$session", encodeURIComponent(session))
