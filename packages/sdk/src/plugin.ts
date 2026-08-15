import type { Effect, Scope } from "effect"
import type { PluginContext } from "./context.js"
import type { Reads } from "./options.js"

export interface Plugin {
  // The identity config, the disable list, and hot replace all use.
  readonly id: string
  /**
   * The top-level config keys this plugin reads. A key nothing declares
   * reached nothing, and a run says so against the file that set it.
   *
   * It is data beside the id rather than a registration, so the sweep
   * answers from the resolved plugin table before the kernel boots. It is
   * not a fifth extension point.
   */
  readonly reads?: Reads
  /**
   * The options this plugin's own config entry takes. The same sweep runs
   * over these, so `maxTokns:` under a plugin entry is named the way a
   * misspelled top-level key is — it used to fall back to the default in
   * silence, because only the top level was ever swept.
   */
  readonly takes?: Reads
  // Runs once at load. Registers into the context. Returns nothing.
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, Scope.Scope>
}

export const define = (plugin: Plugin): Plugin => plugin
