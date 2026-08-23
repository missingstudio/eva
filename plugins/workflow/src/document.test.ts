import { describe, expect, it } from "vitest"
import { readWorkflow } from "./document.js"

const GOOD = {
  name: "Release notes",
  model: "openai/gpt-5",
  steps: [
    {
      id: "summarize",
      template: "release/summarize",
      with: { changelog: "input" },
      schema: {
        type: "object",
        required: ["entries"],
        properties: { entries: { type: "array", items: { type: "string" } } },
      },
    },
    {
      id: "group",
      template: "release/group",
      model: "openai/gpt-5-mini",
      repairs: 2,
      with: { entries: "summarize.output.entries" },
    },
  ],
}

describe("readWorkflow", () => {
  it("reads a good document whole", () => {
    const read = readWorkflow("release-notes", GOOD)

    expect(read.problems).toEqual([])
    expect(read.workflow).toEqual({
      id: "release-notes",
      name: "Release notes",
      model: { provider: "openai", model: "gpt-5" },
      steps: [
        {
          id: "summarize",
          template: "release/summarize",
          with: { changelog: { kind: "input" } },
          schema: GOOD.steps[0]?.schema,
        },
        {
          id: "group",
          template: "release/group",
          model: { provider: "openai", model: "gpt-5-mini" },
          repairs: 2,
          with: { entries: { kind: "output", step: "summarize", path: ["entries"] } },
        },
      ],
    })
  })

  it("names the Workflow by its key when the document gives none", () => {
    const read = readWorkflow("commit-msg", {
      steps: [{ id: "one", template: "commit/subject" }],
    })

    expect(read.name).toBe("commit-msg")
    expect(read.workflow?.name).toBe("commit-msg")
  })

  // Every case below asserts the whole problem list, not the first entry,
  // because reporting them together is the behaviour.
  it.each([
    {
      case: "a missing steps",
      document: { name: "x" },
      problems: ["steps is not a list"],
    },
    {
      case: "an empty steps",
      document: { steps: [] },
      problems: ["steps is empty"],
    },
    {
      case: "a duplicate Step id",
      document: {
        steps: [
          { id: "one", template: "a" },
          { id: "one", template: "b" },
        ],
      },
      problems: ["two steps hold the id one"],
    },
    {
      case: "an unparseable model",
      document: {
        model: "gpt-5",
        steps: [{ id: "one", template: "a", model: "openai/" }],
      },
      problems: [
        "model gpt-5 does not parse as provider/model",
        "step one: model openai/ does not parse as provider/model",
      ],
    },
    {
      case: "a reference to a later Step",
      document: {
        steps: [
          { id: "one", template: "a", with: { next: "two.output" } },
          { id: "two", template: "b", with: { self: "two.output" } },
        ],
      },
      problems: [
        "step one: two.output names no earlier step",
        "step two: two.output names no earlier step",
      ],
    },
    {
      case: "a reference in a shape the language does not have",
      document: {
        steps: [
          { id: "one", template: "a" },
          { id: "two", template: "b", with: { text: "one.result", count: 3 } },
        ],
      },
      problems: [
        "step two: one.result is not input, <step>.output or <step>.output.<path>",
        "step two: 3 is not input, <step>.output or <step>.output.<path>",
      ],
    },
    {
      case: "a repairs that is negative or fractional",
      document: {
        steps: [
          { id: "one", template: "a", repairs: -1 },
          { id: "two", template: "b", repairs: 0.5 },
        ],
      },
      problems: [
        "step one: repairs is -1, not a whole number of zero or more",
        "step two: repairs is 0.5, not a whole number of zero or more",
      ],
    },
    {
      case: "a with key that is not a name",
      document: {
        steps: [{ id: "one", template: "a", with: { "not a name": "input" } }],
      },
      problems: ["step one: not a name is not a name"],
    },
    {
      case: "a step with no id and no template",
      document: { steps: [{}, "text"] },
      problems: ["step 1 has no id", "step 1 has no template", "step 2 is not a mapping"],
    },
    {
      case: "a document that is not a mapping",
      document: "steps: none",
      problems: ["the document is not a mapping"],
    },
  ])("says every problem of $case together", ({ document, problems }) => {
    const read = readWorkflow("broken", document)

    expect(read.problems).toEqual(problems)
    expect(read.workflow).toBeUndefined()
  })

  // The row still registers, so the refusal lands in the Trace at the first
  // Prompt rather than vanishing at load.
  it("keeps the id and a name beside the problems", () => {
    const read = readWorkflow("broken", { name: "Broken", steps: [] })

    expect(read.id).toBe("broken")
    expect(read.name).toBe("Broken")
    expect(read.problems).not.toEqual([])
  })
})
