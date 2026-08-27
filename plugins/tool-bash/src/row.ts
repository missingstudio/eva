import type { ToolInfo } from "@missingstudio/eva-core"
import { takes } from "@missingstudio/eva-sdk"
import { runCommand, type CommandDeps } from "./command.js"

const DESCRIPTION = [
  "Runs a command and answers its output and its exit code.",
  "`command` is the program and its arguments, already split into words.",
  'Nothing reaches a shell, so a shell line is named as ["bash", "-c", line].',
  "`cwd` is the directory to run in. `timeout` is in seconds, and it may only",
  "shorten the limit this Eva allows. A nonzero exit is a result, not a",
  "failure: read the exit code and carry on.",
].join(" ")

/**
 * What the model is told it may send. Only the schema half is taken from the
 * declaration: `readInput` keeps its own reading because it does more than
 * read a shape — a timeout that is not a positive finite number is dropped
 * rather than refused, so a model that wrote one still runs its command.
 */
const TAKES = takes({
  command: {
    shape: "words",
    description: "The program and its arguments, already split into words.",
  },
  cwd: {
    shape: "string",
    optional: true,
    description: "The directory to run in. It defaults to where Eva runs.",
  },
  timeout: {
    shape: "number",
    optional: true,
    description: "Seconds the command may run. It may only shorten the limit this Eva allows.",
  },
})

/**
 * The name a model calls, against the plugin id `eva.tool.bash`.
 *
 * The call id and the emit are the context's, because the output streams: a
 * command that works for a while writes `tool_update` records of its own, and
 * each one joins the call the execution opened.
 */
export const commandTool = (deps: CommandDeps): ToolInfo => ({
  id: "bash",
  description: DESCRIPTION,
  kind: "execute",
  input: TAKES.schema,
  execute: (input, context) =>
    runCommand(deps, { id: context.id, args: input, emit: context.emit }),
})
