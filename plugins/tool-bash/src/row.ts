import type { Domain, Row } from "@missingstudio/eva-core"
import type { ToolKind } from "@missingstudio/eva-schema"
import type { Effect } from "effect"
import { runCommand, type CommandCall, type CommandDeps, type CommandOutcome } from "./command.js"

/**
 * The tool row, as the execution pipeline is expected to hold it, and the
 * domain it goes into. The tool domain arrives with that pipeline, so this
 * file is the plugin's one guess. Everything the tool does is in
 * `command.ts`, which this only names — so the guess costs one file.
 */
export interface ToolInfo {
  id: string
  description: string
  kind: ToolKind
  // A row without `run` names a tool the build knows of but cannot execute.
  run?: (call: CommandCall) => Effect.Effect<CommandOutcome>
}

export type ToolDomain = Domain<readonly ToolInfo[], Row<ToolInfo>>

const DESCRIPTION = [
  "Runs a command and answers its output and its exit code.",
  "`command` is the program and its arguments, already split into words.",
  'Nothing reaches a shell, so a shell line is named as ["bash", "-c", line].',
  "`cwd` is the directory to run in. `timeout` is in seconds, and it may only",
  "shorten the limit this Eva allows. A nonzero exit is a result, not a",
  "failure: read the exit code and carry on.",
].join(" ")

// The name a model calls, against the plugin id `eva.tool.bash`.
export const commandTool = (deps: CommandDeps): ToolInfo => ({
  id: "bash",
  description: DESCRIPTION,
  kind: "execute",
  run: (call) => runCommand(deps, call),
})
