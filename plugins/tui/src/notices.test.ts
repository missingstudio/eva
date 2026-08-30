import type { IntegrationInfo, KeymapInfo } from "@missingstudio/eva-sdk"
import { describe, expect, it } from "vitest"
import { missingCredential, noticesOf, sayKeymap, sayNoCredential } from "./notices.js"

/**
 * The sentences a person reads before the first fold, proved without a
 * renderer, a keymap Domain or a Session.
 *
 * They used to be folded inside the surface's own start, where reaching one
 * meant standing a whole terminal up. Every one of them says a run is degraded
 * — no key, a key that does nothing, a theme that named no row — so a sentence
 * that drifts is a person told the wrong thing about why their work will not
 * start.
 */

const bound = (id: string, binding: string): KeymapInfo => ({ id, binding, command: id })

const key = (
  provider: string,
  over: { readonly connected?: boolean; readonly variable?: string } = {},
): IntegrationInfo => ({
  id: `${provider}.key`,
  provider,
  mode: "api_key",
  connected: over.connected ?? false,
  ...(over.variable === undefined ? {} : { variable: over.variable }),
})

describe("a provider with no key", () => {
  it("names the variable to export and the way out that needs none", () => {
    const said = sayNoCredential("anthropic", "ANTHROPIC_API_KEY")

    expect(said).toContain("no key for anthropic")
    expect(said).toContain("ANTHROPIC_API_KEY")
    expect(said).toContain("Ollama")
  })

  it("says nothing when a row for that provider is connected", () => {
    expect(
      missingCredential("anthropic", [
        key("anthropic", { connected: true, variable: "ANTHROPIC_API_KEY" }),
      ]),
    ).toBeUndefined()
  })

  /**
   * A provider that projects no `api_key` row wants no variable, so a run
   * against an endpoint that needs none is told nothing: a warning about a
   * key nobody reads is noise a person learns to pass over.
   */
  it("says nothing for a provider that asks for no variable", () => {
    expect(missingCredential("ollama", [key("ollama")])).toBeUndefined()
  })

  it("says nothing about a provider this Session does not run on", () => {
    expect(
      missingCredential("anthropic", [key("openai", { variable: "OPENAI_API_KEY" })]),
    ).toBeUndefined()
  })

  it("names the variable when the Session's own provider has none", () => {
    expect(
      missingCredential("anthropic", [key("anthropic", { variable: "ANTHROPIC_API_KEY" })]),
    ).toBe(sayNoCredential("anthropic", "ANTHROPIC_API_KEY"))
  })
})

describe("the keymap sweep", () => {
  it("says nothing about rows that name keys this surface knows", () => {
    expect(sayKeymap([bound("one", "ctrl+a"), bound("two", "ctrl+b")])).toEqual([])
  })

  /**
   * The modifiers are `ctrl`, `meta` and `shift`, so `alt+k` names no key
   * here — the spelling a person most often reaches for from another program,
   * and the one a surface must say it cannot honour.
   */
  it("names a row whose binding is no key here", () => {
    const said = sayKeymap([bound("one", "alt+k")])

    expect(said).toHaveLength(1)
    expect(said[0]).toContain("one")
    expect(said[0]).toContain("alt+k")
  })

  // A chord that is only a modifier names no key either: something has to be
  // pressed with it.
  it("names a row bound to a modifier alone", () => {
    expect(sayKeymap([bound("one", "ctrl")])).toHaveLength(1)
  })

  // The last one wins, so a person who bound it twice is told which of the
  // two they will get rather than left to find out.
  it("names a binding two rows claim, and both rows", () => {
    const said = sayKeymap([bound("one", "ctrl+a"), bound("two", "ctrl+a")])

    expect(said).toHaveLength(1)
    expect(said[0]).toContain("ctrl+a")
    expect(said[0]).toContain("one")
    expect(said[0]).toContain("two")
  })
})

describe("what the surface says before the first fold", () => {
  it("says nothing when nothing is degraded", () => {
    expect(noticesOf({})).toEqual([])
  })

  /**
   * What happened on the way here first, then what this Session cannot do,
   * then what the keyboard will not do. A person reads the reason their run
   * cannot start before they read that a key is idle.
   */
  it("reads in the order a person acts on", () => {
    expect(
      noticesOf({
        said: ["theme dusk is not a theme here"],
        credential: sayNoCredential("anthropic", "ANTHROPIC_API_KEY"),
        keymap: [bound("one", "alt+k")],
      }),
    ).toEqual([
      "theme dusk is not a theme here",
      sayNoCredential("anthropic", "ANTHROPIC_API_KEY"),
      "key binding one names no key this surface knows: alt+k",
    ])
  })

  // An attached terminal is not asked about a key at all: the credentials
  // that decide a Run are the serving process's.
  it("leaves the credential line out when nothing asked for one", () => {
    expect(noticesOf({ said: ["where the page bound"] })).toEqual(["where the page bound"])
  })
})
