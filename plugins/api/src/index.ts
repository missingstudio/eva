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
  /**
   * Where a Session goes when the caller named nowhere. A page holds no
   * honest path, so the serving process answers with its own directory —
   * which is what this reads when nobody hands one over.
   *
   * Handed in at construction, as the terminal is handed its directory and
   * `eva.web` its bind: a run's own facts meet a plugin at the composition
   * root, and a suite that must pin one does it here and not with a chdir.
   */
  readonly directory?: () => string
}

/**
 * The Session API, over HTTP. It registers no row: a wire is not a Domain, the
 * socket is `eva.web`'s, and the contract is the Client's — so loading is the
 * whole of what this plugin does, and the plugin id is what a person turns off.
 *
 * The commands and the Catalog are this plugin's own context, read at the
 * moment a request asks for them. A command reaches Domains, and the Domains
 * are here — so a door that ran `/mode` for itself would change the approval
 * state of its own process and leave the Run under the mode it already had —
 * and the rows `GET /api/models` answers are the rows the terminal's panel
 * picks from in this same build. `PluginContext` extends `Domains`, so this
 * reads both of its own and imports no plugin to reach either.
 */
export const makeApi = (options: ApiOptions): Plugin =>
  define({
    id: API_PLUGIN,
    // The context is read on load and closed over, so both reads stay late.
    effect: (ctx) =>
      Effect.sync(() =>
        options.serve((api) =>
          apiWire(api, {
            ...(options.directory === undefined ? {} : { directory: options.directory }),
            commands: ctx.command.get,
            catalog: ctx.catalog.get,
          }),
        ),
      ),
  })
