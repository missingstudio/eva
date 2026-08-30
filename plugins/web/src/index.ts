import type { Client } from "@missingstudio/eva-client-runtime"
import { declare, define, type Plugin } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { DEFAULT_HOST, DEFAULT_PORT } from "./bind.js"
import { serveWeb, WEB_SURFACE, type Answering } from "./serve.js"

export * from "./ask.js"
export * from "./assets.js"
export * from "./bind.js"
export * from "./serve.js"

/**
 * One artifact serves single-tenant and multi-tenant alike, so the posture is
 * config and never a build variant. `local` is single-tenant, `hosted` is
 * multi-tenant, and W1 reads the name and reports it: what each posture then
 * permits arrives with the token at 9b.
 */
const KEYS = declare({ posture: "name" })
export const DEFAULT_POSTURE = "local"

export interface WebOptions {
  // Where the built page is. A directory, because `eva.web` serves assets it
  // did not build, and a call so the surface reads it when it starts.
  readonly assets: () => string
  /**
   * Where the bound address is said. A `Frontend` carries no address, so the
   * surface says its own — and the built-in table is assembled before a World
   * is read, so an entry with no writer serves and says nothing.
   */
  readonly write?: (text: string) => void
  readonly host?: string
  readonly port?: number
  /**
   * What answers the calls the page makes, given the Client this row is
   * started with. One port carries the page and the wire, and a plugin may
   * not import a plugin — so the composition root hands over the half that
   * answers, and nothing when this build carries no wire.
   */
  readonly api?: (client: Client) => Answering | undefined
}

/**
 * The web surface. It takes the asset root, the bind, and its writer from the
 * composition root, because a plugin may not import an app and because a bind
 * is a fact of one run rather than of the table this plugin sits in.
 */
export const makeWeb = (options: WebOptions): Plugin =>
  define({
    id: WEB_SURFACE,
    reads: KEYS.shapes,
    effect: Effect.fn(WEB_SURFACE)(function* (ctx) {
      // Read when the surface starts rather than here, because the posture a
      // page is served under is the posture at serve time.
      const posture = Effect.gen(function* () {
        return KEYS.read(yield* ctx.config, "posture", DEFAULT_POSTURE)
      })

      /**
       * A row is a factory: nothing binds until `start` runs, so a test that
       * boots this build opens no socket. The Client it is handed is what the
       * wire answers from — the page reaches Eva over that wire and not
       * through this process, and W2 is where the surface itself asks.
       */
      yield* ctx.surface.transform((draft) => {
        draft.set({
          id: WEB_SURFACE,
          /**
           * The page answers a permission request, so Eva may ask this
           * surface. It is honest because the ask channel knows whether a
           * page is open: with none, and again the moment the last one goes,
           * the ask is cancelled rather than held. A row that said `true` and
           * then waited forever would be worse than one that said `false`.
           */
          interactive: true,
          // SSE carries the live tail.
          streaming: true,
          images: false,
          start: (client) =>
            Effect.gen(function* () {
              const wire = options.api?.(client)
              return yield* serveWeb({
                root: options.assets(),
                bind: {
                  host: options.host ?? DEFAULT_HOST,
                  port: options.port ?? DEFAULT_PORT,
                },
                posture: yield* posture,
                ...(options.write === undefined ? {} : { write: options.write }),
                ...(wire === undefined ? {} : { api: wire }),
              })
            }),
        })
      })
    }),
  })
