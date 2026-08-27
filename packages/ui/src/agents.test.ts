import { describe, expect, test } from "vitest"
import { capabilities, installChannels, invocation, whenNotToUse, whenToUse } from "./agents.js"
import { docSlugs } from "./site.js"

describe("the guidance an agent reads", () => {
  test("names jobs rather than describing a product", () => {
    // Generic marketing copy does not read as guidance. Every reason has to
    // say what someone is trying to do, in the second person.
    for (const reason of whenToUse) {
      expect(reason.length, reason).toBeGreaterThan(80)
      expect(reason.startsWith("You "), reason).toBe(true)
    }
  })

  test("says where Eva is the wrong call", () => {
    // The honest half. It is what makes the other list worth believing, and
    // it saves an agent a request that was always going to fail.
    expect(whenNotToUse.length).toBeGreaterThan(2)
    for (const reason of whenNotToUse) expect(reason.startsWith("You ")).toBe(true)
  })

  test("says there is no hosted API, because there is not one", () => {
    const text = whenNotToUse.join(" ").toLowerCase()
    expect(text).toContain("hosted api")
  })
})

describe("the capabilities", () => {
  test("each has a name an Agent Skill can carry", () => {
    for (const capability of capabilities) {
      // Lowercase, hyphen-separated, no leading, trailing or doubled hyphen.
      expect(capability.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(capability.name.length).toBeLessThanOrEqual(64)
      // A skill name that claims to be the vendor's own is refused by the spec.
      expect(capability.name).not.toMatch(/anthropic|claude/)
    }
  })

  test("each is named once", () => {
    const names = capabilities.map((capability) => capability.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test("each says what it does, at a length a description allows", () => {
    for (const capability of capabilities) {
      expect(capability.description.length, capability.name).toBeGreaterThan(80)
      expect(capability.description.length, capability.name).toBeLessThanOrEqual(1024)
    }
  })

  test("each names a command that starts with the program", () => {
    for (const capability of capabilities) {
      expect(capability.command, capability.name).toMatch(/^eva\b/)
    }
  })

  test("each points at a documentation page that exists", () => {
    // The slug is a union, so a page nobody wrote does not compile. This is
    // the check for the case where the union itself goes stale.
    for (const capability of capabilities) {
      expect(docSlugs, capability.name).toContain(capability.slug)
    }
  })
})

describe("the install channels", () => {
  test("every channel carries a label and a command", () => {
    expect(installChannels.length).toBeGreaterThan(0)

    for (const channel of installChannels) {
      expect(channel.label.length).toBeGreaterThan(0)
      expect(channel.command.length).toBeGreaterThan(0)
    }
  })

  test("the npm channel installs the published package", () => {
    const npm = installChannels.find((channel) => channel.id === "npm")
    expect(npm?.command).toContain("@missingstudio/eva")
  })
})

describe("the invocation", () => {
  test("passes the prompt as a flag", () => {
    // With a bare argument accepted, `eva trsut` would be a valid prompt
    // rather than a misspelling Eva can correct.
    expect(invocation.print).toMatch(/^eva -p "/)
  })
})
