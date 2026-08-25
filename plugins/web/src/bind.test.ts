import { describe, expect, it } from "vitest"
import { DEFAULT_HOST, isLocal, refusal } from "./bind.js"

describe("what counts as local", () => {
  it("takes the loopback address, the IPv6 one, and the name a person types", () => {
    for (const host of ["127.0.0.1", "::1", "localhost"]) expect(isLocal(host)).toBe(true)
  })

  // A resolver is case-insensitive, so `LOCALHOST` binds loopback. Refusing
  // it would name the wrong reason for the wrong bind.
  it("reads a name in any case, and around stray space", () => {
    expect(isLocal("LocalHost")).toBe(true)
    expect(isLocal(" 127.0.0.1 ")).toBe(true)
  })

  // 127.0.0.0/8 is loopback whole. An alias like 127.0.0.2 is this machine as
  // much as 127.0.0.1 is, and telling a person it needs a token is a lie.
  it("takes the whole of 127.0.0.0/8, and not its first address alone", () => {
    for (const host of ["127.0.0.2", "127.1.2.3", "127.255.255.254"]) {
      expect(isLocal(host)).toBe(true)
    }
  })

  it("takes the loopback address in its IPv4-mapped spelling", () => {
    expect(isLocal("::ffff:127.0.0.1")).toBe(true)
    expect(isLocal("::FFFF:127.0.0.2")).toBe(true)
  })

  /**
   * The addresses the rule exists for. `0.0.0.0` and `::` are every interface
   * the machine has, and a host nobody named is the same bind by omission —
   * `listen` reads an empty one as none given.
   */
  it("takes no address that reaches another machine", () => {
    for (const host of ["0.0.0.0", "::", "", "0", "::ffff:0.0.0.0"]) {
      expect(isLocal(host)).toBe(false)
    }
  })

  // A LAN address is the bind this is about: it is reachable, and W1 has no
  // token to put in front of it.
  it("takes no address on a network", () => {
    for (const host of ["192.168.1.10", "10.0.0.1", "172.16.0.1", "eva.local"]) {
      expect(isLocal(host)).toBe(false)
    }
  })

  // A name that begins with a loopback address is still a name, and what it
  // resolves to is somebody else's record.
  it("takes no name that only reads like loopback", () => {
    for (const host of ["127.0.0.1.example.com", "localhost.example.com", "127001"]) {
      expect(isLocal(host)).toBe(false)
    }
  })

  // The bind a serve with no `--host` gets. A default the rule refused would
  // make `eva serve --web` refuse itself.
  it("is what the default bind is", () => {
    expect(isLocal(DEFAULT_HOST)).toBe(true)
  })
})

describe("the refusal", () => {
  it("is nothing at all when the bind is local", () => {
    expect(refusal("127.0.0.1")).toBeUndefined()
  })

  // The surface owns the default, so a run that named no host is not refused
  // by a second default living here.
  it("is nothing when no host was named", () => {
    expect(refusal()).toBeUndefined()
  })

  /**
   * The message names the reason and the stage that changes it, so a reader
   * knows this is a door that opens later rather than a defect.
   */
  it("names the reason and stage 9b", () => {
    const said = refusal("0.0.0.0")
    expect(said).toContain("a non-local bind needs a token")
    expect(said).toContain("9b")
  })

  it("refuses every interface, however it is spelled", () => {
    expect(refusal("::")).toBeDefined()
    expect(refusal("192.168.1.10")).toBeDefined()
  })
})
