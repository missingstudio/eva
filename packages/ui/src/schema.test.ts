import { describe, expect, test } from "vitest"
import { docPageGraph, docPageGraphs, homeGraph, schemaIds, trustPageGraph } from "./schema.js"
import { entity, external, origin } from "./site.js"

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

/** Every node declared anywhere in a set of graphs a page emits together. */
const declaredIn = (graphs: unknown[]) =>
  new Set(
    graphs.flatMap((graph) => {
      const node = graph as Record<string, unknown>
      const inner = node["@graph"] as Record<string, unknown>[] | undefined
      return (inner ?? [node]).map((entry) => entry["@id"] as string).filter(Boolean)
    }),
  )

const page = {
  title: "Install",
  description: "Every channel, and how to verify a download.",
  url: `${origin.docs}/install`,
}

describe("the JSON-LD graph", () => {
  test("every @id reference resolves to a node in the graph", () => {
    const graph = homeGraph("0.2.0")
    const declared = ids(graph)

    for (const reference of references(graph["@graph"])) {
      expect(declared.has(reference), `${reference} is referenced but never declared`).toBe(true)
    }
  })

  /*
    The page graph names the company, the product, and the site by id, and the
    nodes those ids name are a second export. The pairing was the caller's to
    remember and nothing checked it, so a page that emitted one and not the
    other handed a reader references it could not resolve.
  */
  test("a documentation page declares every node it names, whatever it carries", () => {
    const shapes = {
      "a bare page": docPageGraphs(page),
      "a page with a trail": docPageGraphs({
        ...page,
        trail: [
          { name: "Docs", url: origin.docs },
          { name: "Install", url: page.url },
        ],
      }),
      "a page with terms": docPageGraphs({
        ...page,
        terms: [{ term: "Harness", definition: "What drives a prompt to a stop reason." }],
      }),
      "a page with questions": docPageGraphs({
        ...page,
        questions: [{ question: "Why does nothing run", answer: "There is no model configured." }],
      }),
      "a page that carries everything": docPageGraphs({
        ...page,
        modified: "2026-08-27",
        version: "0.2.0",
        trail: [
          { name: "Docs", url: origin.docs },
          { name: "Install", url: page.url },
        ],
        terms: [{ term: "Harness", definition: "What drives a prompt to a stop reason." }],
        questions: [{ question: "Why does nothing run", answer: "There is no model configured." }],
      }),
    }

    for (const [what, graphs] of Object.entries(shapes)) {
      const declared = declaredIn(graphs)

      for (const reference of references(graphs)) {
        expect(declared.has(reference), `${what}: ${reference} is never declared`).toBe(true)
      }
    }
  })

  test("a documentation page carries only what it has", () => {
    // A trail of one is not a trail: a breadcrumb with a single crumb tells a
    // reader nothing and is markup an engine has to discard.
    expect(docPageGraphs(page).length).toBe(2)
    expect(docPageGraphs({ ...page, trail: [{ name: "Docs", url: origin.docs }] }).length).toBe(2)
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

describe("the company an engine is asked to verify", () => {
  const company = () => homeGraph()["@graph"].find((n) => n["@id"] === schemaIds.company)!

  test("says how to reach a person, with a type and a channel", () => {
    const point = company()["contactPoint"] as Record<string, string>

    expect(point["@type"]).toBe("ContactPoint")
    expect(point["contactType"]).toBeTruthy()
    // A contact point with a type and no channel answers nothing.
    expect(point["url"] ?? point["email"]).toMatch(/^(https:\/\/|mailto:)/)
  })

  test("says where it is", () => {
    const address = company()["address"] as Record<string, string>

    expect(address["@type"]).toBe("PostalAddress")
    // A two-letter country, which is the whole address this repository holds.
    expect(address["addressCountry"]).toMatch(/^[A-Z]{2}$/)
  })

  test("carries more than one authority profile, and every one is absolute", () => {
    const profiles = company()["sameAs"] as string[]

    expect(profiles.length).toBeGreaterThan(1)
    for (const url of profiles) expect(url).toMatch(/^https:\/\//)
  })

  test("no node carries a placeholder", () => {
    // A placeholder scores once and then answers a question wrongly forever.
    const json = JSON.stringify(homeGraph("0.2.0"))
    for (const word of ["example.com", "TODO", "FIXME", "your-domain", "localhost"]) {
      expect(json.toLowerCase()).not.toContain(word.toLowerCase())
    }
  })
})

describe("a trust anchor page", () => {
  const graph = (type: "AboutPage" | "ContactPage") =>
    trustPageGraph({
      type,
      title: "About",
      description: entity.company.description,
      url: `${origin.web}/about`,
    })["@graph"]

  test("declares its own type and a breadcrumb trail", () => {
    const types = graph("AboutPage").map((node) => node["@type"])
    expect(types).toEqual(["AboutPage", "BreadcrumbList"])
  })

  test("points at the company rather than describing a second one", () => {
    const page = graph("ContactPage")[0]!
    expect(page["publisher"]).toEqual({ "@id": schemaIds.company })
    expect(page["about"]).toEqual({ "@id": schemaIds.company })
  })

  test("the trail starts at the home page", () => {
    const trail = graph("AboutPage")[1]!["itemListElement"] as Record<string, unknown>[]
    expect(trail[0]!["item"]).toBe(origin.web)
    expect(trail[trail.length - 1]!["item"]).toBe(`${origin.web}/about`)
  })
})

describe("the identities the sites publish", () => {
  test("every external link is an absolute https URL", () => {
    for (const [name, url] of Object.entries(external)) {
      expect(url, name).toMatch(/^https:\/\//)
    }
  })
})
