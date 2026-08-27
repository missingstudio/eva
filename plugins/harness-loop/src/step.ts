import type { CalledTool, ProposedCall, ToolDefinition, ToolInfo } from "@missingstudio/eva-core"
import type { ContentBlock, TranscriptMessage } from "@missingstudio/eva-schema"
import { agent, human } from "@missingstudio/eva-sdk"

/**
 * The pure half of a Step: which tools the model is shown, and how the calls
 * it proposed reach the next Step's history.
 *
 * It reads no clock, no slot and no kernel, so the same rows and the same
 * results give the same text — which is what lets a test pin a Step as a
 * golden.
 */

/**
 * The tools the model is shown, from the rows the domain holds now. A row with
 * no `execute` is left out: it names a tool this build knows of and cannot
 * run, and the model may not be offered one of those.
 *
 * The list is read per Step rather than once, so a permission mode that
 * rebuilt the domain is what the next Step offers.
 */
export const offeredIn = (rows: readonly ToolInfo[]): readonly ToolDefinition[] =>
  rows
    .filter((row) => row.execute !== undefined)
    .map((row) => ({ name: row.id, description: row.description, input: row.input }))

// The arguments as text. They arrived as JSON, so they go back as JSON.
const argumentsOf = (args: unknown): string => JSON.stringify(args ?? null)

const textIn = (content: readonly ContentBlock[]): string =>
  content
    .map((block) => (block.type === "text" ? block.text : `<${block.type}>`))
    .join("\n")
    .trim()

// One call the model proposed, said back to it so the next Step reads what
// this one asked for.
export const proposalLine = (call: ProposedCall): string =>
  `tool_call ${call.id} ${call.name} ${argumentsOf(call.args)}`

// One answer, with the Disposition first: every ending is data the model can
// act on, so what kind of ending it was comes before what it said.
export const answerLine = (called: CalledTool): string => {
  const said = textIn(called.result.content)
  const head = `tool_result ${called.call.id} ${called.result.disposition}`
  return said === "" ? head : `${head}\n${said}`
}

/**
 * What one Step adds to the history: what the model said and asked for, then
 * what the tools answered.
 *
 * The exchange rides the history as **text**. `TranscriptMessage` is the one
 * history shape every Provider is handed, and its `tool` block carries neither
 * the arguments nor the result content — so a structured exchange would mean
 * changing the fold's block, all three provider adapters and every golden,
 * for a wire feature only one of them has. Text is what every Provider
 * already carries, and a foreign adapter needs no new capability to read it.
 */
export const stepMessages = (
  text: string,
  called: readonly CalledTool[],
): readonly TranscriptMessage[] => {
  const proposals = called.map((one) => proposalLine(one.call))
  const said = [text.trim(), ...proposals].filter((line) => line !== "").join("\n")
  return [agent(said), human(called.map(answerLine).join("\n"))]
}
