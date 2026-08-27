import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolCall } from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { parse } from "yaml"
import { beforeEach, describe, expect, it } from "vitest"
import { grantedRule, remembering, writeGrant } from "./grant.js"

const call = (args: unknown): ToolCall => ({
  id: "call_1",
  name: "bash",
  args,
  session: sessionID("sess_grant"),
})

const push = call({ command: ["git", "push"] })

let path = ""
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), "eva-grant-")), "config.yaml")
})

// The rules the file now holds, as the profile spells them. The reader that
// judges them is the deterministic gate's, and the conformance suite is where
// the two meet.
const rules = (): readonly unknown[] => {
  const held = parse(readFileSync(path, "utf8")) as Record<string, unknown>
  const policy = held["policy"] as Record<string, unknown>
  return policy["rules"] as readonly unknown[]
}

describe("the grant an allow_always writes", () => {
  it("is an allow rule over the words the call would run", () => {
    expect(grantedRule(["git", "push"], "because")).toEqual({
      allow: [["git"], ["push"]],
      why: "because",
    })
  })

  // It reaches disk as an entry of `policy.rules`, which is the rule language
  // the deterministic gate reads. That the gate then answers from it is proven
  // where the two plugins meet, in `packages/conformance`.
  it("is an entry of policy.rules in the file", () => {
    expect(writeGrant(path, [grantedRule(["git", "push"], "a person allowed it")])).toBe(true)

    expect(rules()).toEqual([{ allow: [["git"], ["push"]], why: "a person allowed it" }])
  })

  it("keeps the keys the file already held", () => {
    writeFileSync(path, "model: anthropic/kept\n")
    writeGrant(path, [grantedRule(["git", "push"], "a person allowed it")])

    expect(parse(readFileSync(path, "utf8"))["model"]).toBe("anthropic/kept")
  })

  it("keeps the rules the person wrote themselves", () => {
    writeFileSync(path, "policy:\n  rules:\n    - deny: [[rm]]\n")
    writeGrant(path, [grantedRule(["git", "push"], "a person allowed it")])

    expect(rules()).toContainEqual({ deny: [["rm"]] })
  })

  // Answering the same question twice is one grant, so a person does not
  // collect copies of their own rule.
  it("writes nothing the second time", () => {
    const rule = [grantedRule(["git", "push"], "a person allowed it")]
    expect(writeGrant(path, rule)).toBe(true)
    expect(writeGrant(path, rule)).toBe(false)
    expect(rules()).toHaveLength(1)
  })
})

describe("an asker that remembers", () => {
  const asking = (kind: "allow_always" | "allow_once", one = push) =>
    Effect.runPromise(
      remembering(() => Effect.succeed({ kind }), { EVA_CONFIG: path })(
        {
          sessionId: one.session,
          toolCall: { toolCallId: one.id, title: "run git push?" },
          options: [],
        },
        one,
      ),
    )

  it("writes the grant when the answer says always", async () => {
    expect(await asking("allow_always")).toEqual({ kind: "allow_always" })
    expect(rules()).toEqual([
      { allow: [["git"], ["push"]], why: "a person allowed this: run git push?" },
    ])
  })

  it("writes nothing when the answer says once", async () => {
    expect(await asking("allow_once")).toEqual({ kind: "allow_once" })
    expect(() => readFileSync(path, "utf8")).toThrow()
  })

  // The call still runs. What it cannot do is be remembered, and a person who
  // wants that changes the mode.
  it("allows a call it cannot grant, and remembers nothing", async () => {
    expect(await asking("allow_always", call({ path: "one.md" }))).toEqual({
      kind: "allow_always",
    })
    expect(() => readFileSync(path, "utf8")).toThrow()
  })

  /**
   * The rule names the words the gate judged. A person asked about
   * `bash -c "git status"` was asked about `git status`, so a rule over
   * `bash`, `-c` and the line would be well formed and could never fire.
   */
  it("writes the grant over the words the gate judged, not the argument list", async () => {
    await asking("allow_always", call({ command: ["bash", "-c", "git status"] }))

    expect(rules()).toEqual([
      { allow: [["git"], ["status"]], why: "a person allowed this: run git push?" },
    ])
  })

  it("writes one rule for every Invocation of a chain", async () => {
    await asking("allow_always", call({ command: ["bash", "-c", "git status && git diff"] }))

    expect(rules()).toEqual([
      { allow: [["git"], ["status"]], why: "a person allowed this: run git push?" },
      { allow: [["git"], ["diff"]], why: "a person allowed this: run git push?" },
    ])
  })

  // No rule could fire for it, so a rule that claimed to would be a person
  // told they had granted something they had not.
  it("remembers nothing about an Opaque Invocation", async () => {
    expect(
      await asking("allow_always", call({ command: ["bash", "-c", "rm -rf $(cat target)"] })),
    ).toEqual({ kind: "allow_always" })

    expect(() => readFileSync(path, "utf8")).toThrow()
  })
})
