import { declare, define, type Plugin } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { DEFAULT_HOST, DEFAULT_PORT } from "./bind.js"
import { serveWeb, WEB_SURFACE } from "./serve.js"

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
       * boots this build opens no socket. The Client it is handed goes
       * unused, because the page reaches Eva over the wire `eva.api` serves
       * and not through this process — W2 is where the surface itself asks.
       */
      yield* ctx.surface.transform((draft) => {
        draft.set({
          id: WEB_SURFACE,
          // The page takes no input in W1, so Eva never asks it anything and
          // the tool gate turns an ask into a rejection rather than a wait.
          interactive: false,
          // SSE carries the live tail.
          streaming: true,
          images: false,
          start: () =>
            Effect.gen(function* () {
              return yield* serveWeb({
                root: options.assets(),
                bind: {
                  host: options.host ?? DEFAULT_HOST,
                  port: options.port ?? DEFAULT_PORT,
                },
                posture: yield* posture,
                ...(options.write === undefined ? {} : { write: options.write }),
              })
            }),
        })
      })
    }),
  })
