import type { ToolKind } from "@missingstudio/eva-schema"
import type { PluginContext } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { makeEditTool, type EditInput, type EditOutcome, type EditTool } from "./tool.js"

/**
 * The row this plugin offers the tool domain, and the one part of the plugin
 * that guesses.
 *
 * The tool domain arrives with the execution pipeline, so there is nothing to
 * hand a row to yet. The shape is what `architecture.md` §4.2 states for a
 * row that describes an action — the row carries the action — and §9.2 states
 * this plugin contributes a tool transform. When the domain lands, `editToolOf`
 * gains the one line that hands the row over and nothing else here changes.
 *
 * `undo` is not on the row. A row is what a model calls, and an undo is not:
 * it is reached through the `EditTool` this function answers, which is what a
 * permission gate or a surface holds.
 */
export interface EditToolRow {
  readonly id: string
  readonly kind: ToolKind
  readonly description: string
  // JSON Schema, the way a Validator is handed one.
  readonly input: unknown
  readonly execute: (input: EditInput) => Effect.Effect<EditOutcome>
}

// What the model is told it may send.
export const EDIT_TOOL_INPUT = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "The file to edit. It is relative to the workspace root, and it must exist.",
    },
    hunks: {
      type: "array",
      minItems: 1,
      description: "The replacements to land, in order.",
      items: {
        type: "object",
        properties: {
          find: {
            type: "string",
            description: "The exact text to replace. It must appear once in the file.",
          },
          replace: { type: "string", description: "The text that takes its place." },
        },
        required: ["find", "replace"],
      },
    },
    dryRun: {
      type: "boolean",
      description: "Answer what the edit would write, and write nothing.",
    },
  },
  required: ["path", "hunks"],
}

const rowOf = (tool: EditTool): EditToolRow => ({
  id: "edit",
  kind: "edit" satisfies ToolKind,
  description:
    "Replace exact text in one file. Every hunk lands or none does, the change can be " +
    "previewed first, and an applied change can be undone.",
  input: EDIT_TOOL_INPUT,
  execute: tool.execute,
})

/**
 * The tool, built against the slots the context holds, and the row that
 * offers it.
 *
 * The three slots are handed over as reads and not as values, so each call
 * writes through whichever `FileSystem` fills the slot at that moment.
 */
export const editToolOf = (
  ctx: Pick<PluginContext, "slot">,
): Effect.Effect<{ readonly tool: EditTool; readonly row: EditToolRow }> =>
  Effect.sync(() => {
    const tool = makeEditTool({
      files: ctx.slot.fileSystem.peek,
      applier: ctx.slot.diffApplier.peek,
      recorder: ctx.slot.recorder.peek,
    })
    return { tool, row: rowOf(tool) }
  })
