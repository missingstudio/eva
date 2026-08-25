import type { IncomingMessage, ServerResponse } from "node:http"
import type { SessionAPI } from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { API_ROOT, SESSIONS } from "./wire.js"

/**
 * Something that may answer a request, and says whether it did. The socket
 * belongs to `eva.web` and this is what it offers a request to first: a
 * plugin may not import a plugin, so the composition root takes the half
 * that answers and hands it to the half that binds.
 */
export type Wire = (request: IncomingMessage, response: ServerResponse) => boolean

// What one request is answered with. A route is a description and not a
// write, so the table is a pure function and the socket is thin around it.
export interface Answer {
  readonly status: number
  readonly body: unknown
}

export type Route = (api: SessionAPI) => Effect.Effect<Answer>

const MODEL = new RegExp(`^${SESSIONS}/([^/]+)/model$`)

// A segment is a name, and a name that is not valid percent-encoding names
// nothing. A request a browser can send may never end a server.
const nameOf = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/**
 * The read half `eva.api` carries, and no more of it. `attach` arrives with
 * the page that folds a Transcript and `watch` with the page that follows
 * one, so no part of the wire is built ahead of a caller. The write half is
 * stage 2's, against the permission gate that stage builds anyway.
 *
 * `create` is in neither half: a page that takes no input opens no Session.
 */
export const routeFor = (method: string, path: string): Route | undefined => {
  if (method !== "GET") return undefined

  if (path === SESSIONS) {
    return (api) => Effect.map(api.list, (rows) => ({ status: 200, body: rows }))
  }

  const named = MODEL.exec(path)?.[1]
  const session = named === undefined ? undefined : nameOf(named)
  if (session !== undefined) {
    const asked = sessionID(session)
    return (api) => Effect.map(api.model.get(asked), (found) => ({ status: 200, body: found }))
  }

  return undefined
}

const HEAD = {
  "content-type": "application/json; charset=utf-8",
  // The record as it stands, every time. A listing held from before the last
  // Run is a listing that is wrong.
  "cache-control": "no-store",
}

/**
 * A path under the root that no route carries. It is refused here rather than
 * left to fall through, because the page's own server answers an unknown path
 * with the page: a call answered with HTML reads as a broken parse instead of
 * as a miss.
 */
const MISS: Answer = { status: 404, body: { error: "the wire does not carry this" } }

// The request path, with the query and the fragment off it. Undecoded: a
// segment is decoded where it is read, so a name carrying a slash cannot
// become two segments.
const pathOf = (url: string): string | undefined => {
  try {
    return new URL(url, "http://eva.invalid").pathname
  } catch {
    return undefined
  }
}

/**
 * Everything under the root, answered from the contract it was given. Which
 * filler that is — the kernel's, or one a suite stands up — is not a fact
 * this wire holds: it calls the Session API as any other caller does.
 */
export const apiWire =
  (api: SessionAPI): Wire =>
  (request, response) => {
    const asked = pathOf(request.url ?? "/")
    if (asked === undefined || !(asked === API_ROOT || asked.startsWith(`${API_ROOT}/`))) {
      return false
    }

    const route = routeFor(request.method ?? "GET", asked)
    /**
     * Forked, because a socket callback is not an Effect. The two methods
     * this wire carries need no Scope, so nothing outlives the request that
     * asked for it; `attach` needs one and that is 005's to arrange.
     */
    Effect.runFork(
      Effect.map(route === undefined ? Effect.succeed(MISS) : route(api), (answer) => {
        response.writeHead(answer.status, HEAD)
        response.end(`${JSON.stringify(answer.body)}\n`)
      }),
    )
    return true
  }
