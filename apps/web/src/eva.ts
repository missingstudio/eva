import { httpTransport, readModels, type PickRow } from "@missingstudio/eva-api/client"
import { makeClient, type Client } from "@missingstudio/eva-client-runtime"
import type { Running } from "@missingstudio/eva-sdk"
import { Effect } from "effect"

// One row of the Catalog, as the picker draws it. Said again here for the
// reason everything else in this file is: the wire is named at one site.
export type { PickRow }

/**
 * The one Client this page holds, and the only way anything on the page
 * reaches Eva. `client-runtime` owns where the runtime is and what a
 * reconnect costs, so a second Client would be a second answer to both — and
 * a call that went around it would be a copy of the rule W0 moved here.
 *
 * The wire is same-origin: `eva.web` served this page and `eva.api` answers
 * beside it on the one port, so nothing here knows an address.
 */
interface Held {
  readonly client: Client
  readonly command: Running
}

let held: Promise<Held> | undefined

const one = (): Promise<Held> =>
  (held ??= Effect.runPromise(
    Effect.flatMap(httpTransport(), (transport) =>
      Effect.map(makeClient(transport), (client) => ({ client, command: transport.command })),
    ),
  ))

export const client = (): Promise<Client> => one().then((each) => each.client)

/**
 * How the page runs a command line. A command is not a Session API call — the
 * contract has no command method — so it comes off the transport beside the
 * Client rather than through it. It is the same transport all the same: one
 * pipe, and one answer to where the runtime is.
 */
export const command = (): Promise<Running> => one().then((each) => each.command)

/**
 * Every model the Catalog behind that wire knows. It is read here and not
 * through the Client, because it is no Session API call: a Catalog is a fact
 * of the build, so `client-runtime` has nothing to say about it and no rule
 * of its own to keep. The wire is still named at one site, which is this one.
 *
 * Nothing is what a far side that answered no rows gives back.
 */
export const models = (): Promise<readonly PickRow[] | undefined> => Effect.runPromise(readModels())
