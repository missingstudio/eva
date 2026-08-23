import { describe, expect, it } from "vitest"
import { readEntries } from "./entry.js"

describe("readEntries", () => {
  // An entry without a base URL is not an endpoint: it claims no namespace
  // and writes no rows.
  it("drops an entry with no api", () => {
    expect(readEntries({ ollama: { name: "Ollama" } })).toEqual([])
  })

  it("keys the entry by the mapping key, which is the namespace", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1" } })

    expect(found).toHaveLength(1)
    expect(found[0]?.namespace).toBe("ollama")
    expect(found[0]?.api).toBe("http://localhost:11434/v1")
  })

  it("defaults name to the mapping key", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1" } })

    expect(found[0]?.name).toBe("ollama")
  })

  it("carries a given name", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1", name: "Ollama" } })

    expect(found[0]?.name).toBe("Ollama")
  })

  it("yields no model rows when models is absent", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1" } })

    expect(found[0]?.models).toEqual([])
  })

  it("carries the model ids the entry names", () => {
    const found = readEntries({
      ollama: { api: "http://localhost:11434/v1", models: ["qwen3-coder", "llama4"] },
    })

    expect(found[0]?.models).toEqual(["qwen3-coder", "llama4"])
  })

  // The server's own default is better than one Eva invented.
  it("omits maxTokens when absent rather than defaulting it", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1" } })

    expect(found[0]).not.toHaveProperty("maxTokens")
  })

  it("carries a given maxTokens", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1", maxTokens: 4096 } })

    expect(found[0]?.maxTokens).toBe(4096)
  })

  it("reads usage as true when absent", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1" } })

    expect(found[0]?.usage).toBe(true)
  })

  it("reads usage false for a server that refuses the field", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1", usage: false } })

    expect(found[0]?.usage).toBe(false)
  })

  it("reads credential as false when absent, so no key is needed", () => {
    const found = readEntries({ ollama: { api: "http://localhost:11434/v1" } })

    expect(found[0]?.credential).toBe(false)
  })

  it("reads credential true, so the store is asked", () => {
    const found = readEntries({ vllm: { api: "http://gpu:8000/v1", credential: true } })

    expect(found[0]?.credential).toBe(true)
  })

  // Inside a declared mapping the keys are the person's own; a value written
  // in another shape falls back rather than being coerced.
  it("drops an entry whose value is not a mapping", () => {
    expect(readEntries({ ollama: "http://localhost:11434/v1" })).toEqual([])
  })

  it("drops a model id that is not a string", () => {
    const found = readEntries({
      ollama: { api: "http://localhost:11434/v1", models: ["qwen3-coder", 7] },
    })

    expect(found[0]?.models).toEqual(["qwen3-coder"])
  })
})
