import { httpTransport, type Commanding } from "@missingstudio/eva-api/client"
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
interface Held {
  readonly client: Client
  readonly command: Commanding
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
export const command = (): Promise<Commanding> => one().then((each) => each.command)
