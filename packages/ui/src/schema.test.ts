import { describe, expect, test } from "vitest"
import { docPageGraph, homeGraph, schemaIds } from "./schema.js"
import { entity } from "./site.js"

const ids = (graph: { "@graph": Record<string, unknown>[] }) =>
  new Set(graph["@graph"].map((node) => node["@id"] as string))

// Collect every { "@id": "…" } reference in a value, at any depth.
const references = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) references(item, found)
    return found
  }
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>
    const keys = Object.keys(node)
    if (keys.length === 1 && keys[0] === "@id") found.push(node["@id"] as string)
    else for (const item of Object.values(node)) references(item, found)
  }
  return found
}

describe("the JSON-LD graph", () => {
  test("every @id reference resolves to a node in the graph", () => {
    const graph = homeGraph("0.2.0")
    const declared = ids(graph)

    for (const reference of references(graph["@graph"])) {
      expect(declared.has(reference), `${reference} is referenced but never declared`).toBe(true)
    }
  })

  test("the company and the product are separate nodes", () => {
    const declared = ids(homeGraph())
    expect(declared.has(schemaIds.company)).toBe(true)
    expect(declared.has(schemaIds.product)).toBe(true)
    expect(schemaIds.company).not.toBe(schemaIds.product)
  })

  test("the company and the product do not share external identifiers", () => {
    const graph = homeGraph()["@graph"]
    const company = graph.find((n) => n["@id"] === schemaIds.company)!
    const product = graph.find((n) => n["@id"] === schemaIds.product)!

    const shared = (company["sameAs"] as string[]).filter((url) =>
      (product["sameAs"] as string[]).includes(url),
    )

    // Pointing both at the same URLs is what merges a company into its product.
    expect(shared).toEqual([])
  })

  test("the product advertises exactly one offer until the service ships", () => {
    const product = homeGraph()["@graph"].find((n) => n["@id"] === schemaIds.product)!
    expect((product["offers"] as unknown[]).length).toBe(1)
  })

  test("a documentation page references the product rather than restating it", () => {
    const page = docPageGraph({
      title: "Install",
      description: entity.product.description,
      url: "https://docs.evafactory.co/install",
    })

    expect(page.about).toEqual({ "@id": schemaIds.product })
    expect(page.publisher).toEqual({ "@id": schemaIds.company })
  })
})
