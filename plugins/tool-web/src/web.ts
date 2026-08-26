import { toolText, type ToolInfo } from "@missingstudio/eva-core"
import { Data, Effect } from "effect"

// Nothing answered the address. What a server answers is a `Fetched`, however
// it answered: a 404 is a result and not a failure of the call.
export class WebError extends Data.TaggedError("WebError")<{
  readonly message: string
}> {}

export interface Fetched {
  readonly status: number
  readonly body: string
}

/**
 * How the tool reads one address. There is no `Fetcher` slot and this stage
 * adds none, so the reader is handed in: the plugin hands in the one over
 * `fetch`, and a test hands in its own and needs no network.
 */
export type Reading = (url: string) => Effect.Effect<Fetched, WebError>

export interface WebDeps {
  readonly get: Reading
}

const INPUT = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "An http or https address to read.",
    },
  },
  required: ["url"],
  additionalProperties: false,
}

// The address, or nothing when it is not one this tool reads. A scheme other
// than http and https is refused here: `file:` and `data:` reach past the
// workspace, and this tool is the one that leaves the machine.
const addressOf = (input: unknown): string | undefined => {
  const asked = (input as { url?: unknown } | undefined)?.url
  if (typeof asked !== "string" || !URL.canParse(asked)) return undefined
  const parsed = new URL(asked)
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? asked : undefined
}

/**
 * Reads one address and answers what it said. A status outside 2xx is a
 * failed call carrying the status, because the model recovers from the number
 * and not from a body the server wrote for a browser.
 */
export const webTool = (deps: WebDeps): ToolInfo => ({
  id: "web",
  kind: "fetch",
  description: "Read an http or https address and answer what it holds.",
  input: INPUT,
  // Reading an address changes nothing here, so two reads may run at once.
  parallelSafe: () => true,
  execute: (input) =>
    Effect.gen(function* () {
      const url = addressOf(input)
      if (url === undefined) return toolText("failed", "web wants an http or https `url`")

      const answer = yield* deps.get(url)
      return answer.status >= 200 && answer.status < 300
        ? toolText("ok", answer.body)
        : toolText("failed", `${url} answered ${answer.status}`)
    }).pipe(
      Effect.catchTag("WebError", (fault) => Effect.succeed(toolText("failed", fault.message))),
    ),
})

/**
 * The reader the plugin uses: one GET, and the body as text. It is the only
 * part of this plugin that leaves the machine, which is why it is this small
 * and why it is injected.
 */
export const overFetch: Reading = (url) =>
  Effect.tryPromise({
    try: async () => {
      const answer = await fetch(url)
      return { status: answer.status, body: await answer.text() }
    },
    catch: (cause) =>
      new WebError({ message: cause instanceof Error ? cause.message : String(cause) }),
  })
