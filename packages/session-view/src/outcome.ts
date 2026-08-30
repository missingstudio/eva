import type { ErrorClass, Result } from "@missingstudio/eva-schema"

/**
 * What a Run's ending is called. A Run that stopped and a Run that finished
 * are two endings, so they are two phrases, and a renderer reads them here
 * rather than writing its own — two doors that word one ending differently
 * are two products.
 */
export const resultText = (result: Result): string =>
  result === "failed" ? "the run stopped" : "the run finished"

/**
 * One error class in words a person can act on: what it means, and the one
 * step to take next. Two fields and not one sentence, because a surface with
 * two lines puts them on two and a surface with one joins them.
 */
export interface ErrorWords {
  readonly means: string
  readonly next: string
}

/**
 * The eight classes, one sentence each, written once for every door.
 *
 * The set is closed and this table is keyed by it, so a class the schema adds
 * is a type error here rather than a Run that stops and says nothing.
 *
 * No provider is named and no word of ours reaches a reader: the class is the
 * same fact at every provider, and a person reading it is not reading our
 * code.
 */
const WORDS: Record<ErrorClass, ErrorWords> = {
  rate_limit: {
    means: "The provider limits how often Eva may ask, and this Run reached the limit.",
    next: "Wait a moment, then run it again.",
  },
  overloaded: {
    means: "The provider has no capacity for this request now.",
    next: "Try again in a moment, or name a different model.",
  },
  auth_failed: {
    means: "The provider rejected the credentials it was given.",
    next: "Check the API key for this provider, then try again.",
  },
  unreachable: {
    means: "Eva could not reach the provider.",
    next: "Check the network and the endpoint in config, then try again.",
  },
  server_error: {
    means: "The provider answered with an error of its own.",
    next: "Try again. If it holds, name a different model.",
  },
  no_such_model: {
    means: "The provider does not have the model this Run asked for.",
    next: "Run eva config show, then name a model the provider has.",
  },
  billing: {
    means: "The provider will not bill this account for more work.",
    next: "Check the plan and the payment on the provider account, then try again.",
  },
  other: {
    means: "Nothing classified this failure.",
    next: "Read what the Run said, and the Trace, for what happened.",
  },
}

export const errorWords = (errorClass: ErrorClass): ErrorWords => WORDS[errorClass]

// The two sentences as one line, for a surface that has one line to say them
// on. The join is here, so the two doors cannot join them differently.
export const errorText = (errorClass: ErrorClass): string => {
  const words = WORDS[errorClass]
  return `${words.means} ${words.next}`
}
