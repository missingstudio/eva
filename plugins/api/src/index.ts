import type { SessionAPI } from "@missingstudio/eva-core"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { apiWire, type Answering } from "./routes.js"
import { API_PLUGIN } from "./wire.js"

export * from "./routes.js"
export * from "./wire.js"

export interface ApiOptions {
  /**
   * Where the wire goes when this plugin loads. `eva.api` answers on a port
   * it does not own, because a plugin may not import a plugin — so the
   * composition root takes the half that answers and hands it to the half
   * that binds, as it hands the terminal its renderer.
   *
   * Handed over on load rather than read from the table, so a build that does
   * not carry `eva.api` hands over nothing: the page is served and its calls
   * are answered by nobody, which is a degradation and not a crash.
   */
  readonly serve: (wire: (api: SessionAPI) => Answering) => void
}

/**
 * The read half of the Session API, over HTTP. It registers no row: a wire is
 * not a Domain, the socket is `eva.web`'s, and the contract is the Client's —
 * so loading is the whole of what this plugin does, and the plugin id is what
 * a person turns off.
 */
export const makeApi = (options: ApiOptions): Plugin =>
  define({
    id: API_PLUGIN,
    effect: () => Effect.sync(() => options.serve(apiWire)),
  })
