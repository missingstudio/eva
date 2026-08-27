import type { ToolInfo } from "@missingstudio/eva-core"
import { runCommand, type CommandDeps } from "./command.js"

const DESCRIPTION = [
  "Runs a command and answers its output and its exit code.",
  "`command` is the program and its arguments, already split into words.",
  'Nothing reaches a shell, so a shell line is named as ["bash", "-c", line].',
  "`cwd` is the directory to run in. `timeout` is in seconds, and it may only",
  "shorten the limit this Eva allows. A nonzero exit is a result, not a",
  "failure: read the exit code and carry on.",
].join(" ")

// What the model is told it may send, which is the shape `readInput` reads.
const INPUT = {
  type: "object",
  properties: {
    command: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
      description: "The program and its arguments, already split into words.",
    },
    cwd: {
      type: "string",
      description: "The directory to run in. It defaults to where Eva runs.",
    },
    timeout: {
      type: "number",
      description: "Seconds the command may run. It may only shorten the limit this Eva allows.",
    },
  },
  required: ["command"],
  additionalProperties: false,
}

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
  input: INPUT,
  execute: (input, context) =>
    runCommand(deps, { id: context.id, args: input, emit: context.emit }),
})
