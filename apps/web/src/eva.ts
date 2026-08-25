import { httpTransport } from "@missingstudio/eva-api/client"
import { makeClient, type Client } from "@missingstudio/eva-client-runtime"
import { Effect } from "effect"

/**
 * The one Client this page holds, and the only way anything on the page
 * reaches Eva. `client-runtime` owns where the runtime is and what a
 * reconnect costs, so a second Client would be a second answer to both — and
 * a call that went around it would be a copy of the rule W0 moved here.
 *
 * The wire is same-origin: `eva.web` served this page and `eva.api` answers
 * beside it on the one port, so nothing here knows an address.
 */
let held: Promise<Client> | undefined

export const client = (): Promise<Client> =>
  (held ??= Effect.runPromise(Effect.flatMap(httpTransport(), makeClient)))
