import { toolText, type Hunk, type ToolInfo, type ToolResult } from "@missingstudio/eva-core"
import type { ToolKind } from "@missingstudio/eva-schema"
import type { PluginContext } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { makeEditTool, type EditInput, type EditOutcome, type EditTool } from "./tool.js"

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

const hunkOf = (found: unknown): Hunk | undefined => {
  if (typeof found !== "object" || found === null) return undefined
  const { find, replace } = found as Record<string, unknown>
  return typeof find === "string" && typeof replace === "string" ? { find, replace } : undefined
}

// Every Hunk, or nothing when one of them is not a Hunk. A part of an Edit is
// not an Edit: the applier lands all of them or none.
const hunksOf = (listed: readonly unknown[]): readonly Hunk[] | undefined => {
  const hunks: Hunk[] = []
  for (const one of listed) {
    const hunk = hunkOf(one)
    if (hunk === undefined) return undefined
    hunks.push(hunk)
  }
  return hunks
}

// The arguments, read as the Edit they are. Nothing means they name no edit.
const editOf = (input: unknown): EditInput | undefined => {
  if (typeof input !== "object" || input === null) return undefined
  const asked = input as Record<string, unknown>
  const path = asked["path"]
  const listed = asked["hunks"]
  if (typeof path !== "string" || path === "" || !Array.isArray(listed)) return undefined

  const hunks = hunksOf(listed)
  if (hunks === undefined || hunks.length === 0) return undefined

  return { path, hunks, ...(asked["dryRun"] === true ? { dryRun: true } : {}) }
}

/**
 * The outcome, as the result the model reads. Every ending is a result, so a
 * refusal and an empty slot are `failed` and nothing throws.
 *
 * The undo token stays out of the result. A row is what a model calls, and
 * reversing a write is not one of those calls — the token reaches whoever
 * holds the `EditTool`.
 */
const resultOf = (outcome: EditOutcome): ToolResult => {
  switch (outcome.kind) {
    case "previewed":
      return toolText("ok", `${outcome.path} is not written. It would hold:\n${outcome.after}`)
    case "applied":
      return toolText("ok", `${outcome.path}: ${outcome.hunks} hunks landed`)
    case "refused":
      return toolText("failed", `${outcome.path}: ${outcome.message}`)
    case "degraded":
      return toolText("failed", `nothing fills ${outcome.missing.join(", ")}`)
  }
}

/**
 * The row this plugin offers the tool domain.
 *
 * It says nothing about progress: one write is one act. It does hand the
 * pipeline's own emit down, because the `edit` record belongs in the call's
 * group and in the order it happened — a commit straight to the Recorder
 * lands ahead of the `tool_call` it belongs to.
 *
 * `undo` is not on the row. A row is what a model calls, and an undo is not:
 * it is reached through the `EditTool` `editToolOf` answers, which is what a
 * permission gate or a surface holds.
 */
const rowOf = (tool: EditTool): ToolInfo => ({
  id: "edit",
  kind: "edit" satisfies ToolKind,
  description:
    "Replace exact text in one file. Every hunk lands or none does, the change can be " +
    "previewed first, and an applied change can be undone.",
  input: EDIT_TOOL_INPUT,
  execute: (input, context) =>
    Effect.gen(function* () {
      const edit = editOf(input)
      if (edit === undefined)
        return toolText("failed", "edit wants a `path` string and one or more `hunks`")

      return resultOf(yield* tool.execute(edit, context.emit))
    }),
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
): Effect.Effect<{ readonly tool: EditTool; readonly row: ToolInfo }> =>
  Effect.sync(() => {
    const tool = makeEditTool({
      files: ctx.slot.fileSystem.peek,
      applier: ctx.slot.diffApplier.peek,
      recorder: ctx.slot.recorder.peek,
    })
    return { tool, row: rowOf(tool) }
  })
