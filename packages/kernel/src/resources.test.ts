import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { directoryLayer, fileLayer, layered } from "./config.js"
import { resources } from "./resources.js"

const scratch = () => realpathSync.native(mkdtempSync(join(tmpdir(), "eva-resources-")))

const write = (directory: string, name: string, source: string): string => {
  const path = join(directory, name)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, source)
  return path
}

describe("resources", () => {
  it("reads a directory that is not there as nothing at all", () => {
    expect(resources(join(scratch(), "absent"))).toEqual({ raw: {}, origin: {} })
  })

  it("takes an agent's id from its file name and its prompt from the body", () => {
    const directory = scratch()
    write(directory, "agents/review.md", "Read the diff, then say what is wrong.")

    expect(resources(directory).raw["agents"]).toEqual({
      review: { prompt: "Read the diff, then say what is wrong." },
    })
  })

  it("reads frontmatter beside the body", () => {
    const directory = scratch()
    write(directory, "agents/review.md", "---\ntools: [read, grep]\n---\nRead the diff.")

    expect(resources(directory).raw["agents"]).toEqual({
      review: { tools: ["read", "grep"], prompt: "Read the diff." },
    })
  })

  it("names the file that holds each field", () => {
    const directory = scratch()
    const path = write(directory, "agents/review.md", "Read the diff.")

    expect(resources(directory).origin).toEqual({ "agents.review.prompt": path })
  })

  it("describes a command from its frontmatter, or its first line", () => {
    const directory = scratch()
    write(directory, "commands/deploy.md", "---\ndescription: ship it\n---\nbody")
    write(directory, "commands/check.md", "\nRun the gate\nand report\n")

    expect(resources(directory).raw["commands"]).toEqual({
      deploy: { description: "ship it" },
      check: { description: "Run the gate" },
    })
  })

  it("takes a prompt's id from its file name and its text from the body", () => {
    const directory = scratch()
    const path = write(directory, "prompts/commit-msg.md", "Write one line for {{diff}}.")

    expect(resources(directory).raw["prompts"]).toEqual({
      "commit-msg": { text: "Write one line for {{diff}}." },
    })
    expect(resources(directory).origin).toEqual({ "prompts.commit-msg.text": path })
  })

  it("reads a prompt's frontmatter beside the body", () => {
    const directory = scratch()
    write(directory, "prompts/commit-msg.md", "---\nnote: terse\n---\nWrite one line.")

    expect(resources(directory).raw["prompts"]).toEqual({
      "commit-msg": { note: "terse", text: "Write one line." },
    })
  })

  it("holds no prompts when the directory has none, which is not an error", () => {
    const directory = scratch()
    write(directory, "agents/review.md", "Read the diff.")

    expect(resources(directory).raw["prompts"]).toBeUndefined()
  })

  it("reads a theme as the mapping its file holds", () => {
    const directory = scratch()
    write(directory, "themes/dusk.yaml", "name: Dusk\ncolors:\n  foreground: '#eee'\n")

    expect(resources(directory).raw["themes"]).toEqual({
      dusk: { name: "Dusk", colors: { foreground: "#eee" } },
    })
  })

  it("reads a workflow as the mapping its file holds, keyed by its base name", () => {
    const directory = scratch()
    const path = write(
      directory,
      "workflows/release-notes.yaml",
      "name: Release notes\nsteps:\n  - id: summarize\n    template: release/summarize\n",
    )

    expect(resources(directory).raw["workflows"]).toEqual({
      "release-notes": {
        name: "Release notes",
        steps: [{ id: "summarize", template: "release/summarize" }],
      },
    })
    expect(resources(directory).origin["workflows.release-notes.name"]).toBe(path)
  })

  it("passes over a file the directory does not claim", () => {
    const directory = scratch()
    write(directory, "agents/notes.txt", "not an agent")
    write(directory, "agents/.hidden.md", "not an agent either")

    expect(resources(directory).raw["agents"]).toBeUndefined()
  })
})

describe("a directory as a layer", () => {
  // The config file is the one place a person goes to override, so it wins
  // over a resource the same directory discovered.
  it("lets the config file in the same directory win", async () => {
    const directory = scratch()
    write(directory, "agents/review.md", "from the file")
    write(directory, "config.yaml", "agents:\n  review:\n    prompt: from the config\n")

    const config = await Effect.runPromise(
      layered([directoryLayer(directory), fileLayer(join(directory, "config.yaml"))]),
    )
    expect(config.raw["agents"]).toEqual({ review: { prompt: "from the config" } })
  })

  it("keeps the fields the config file did not name", async () => {
    const directory = scratch()
    write(directory, "agents/review.md", "---\ntools: [read]\n---\nfrom the file")
    write(directory, "config.yaml", "agents:\n  review:\n    prompt: from the config\n")

    const config = await Effect.runPromise(
      layered([directoryLayer(directory), fileLayer(join(directory, "config.yaml"))]),
    )
    expect(config.raw["agents"]).toEqual({
      review: { tools: ["read"], prompt: "from the config" },
    })
  })

  it("lets a later directory override one field of an earlier agent", async () => {
    const user = scratch()
    const project = scratch()
    write(user, "agents/review.md", "---\ntools: [read]\n---\nthe user prompt")
    write(project, "agents/review.md", "the project prompt")

    const config = await Effect.runPromise(layered([directoryLayer(user), directoryLayer(project)]))
    expect(config.raw["agents"]).toEqual({
      review: { tools: ["read"], prompt: "the project prompt" },
    })
  })
})
