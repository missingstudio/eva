import { agentSkillsIndex, capabilitySkills } from "@missingstudio/machine"
import { json } from "@missingstudio/machine/serve"
import { createFileRoute } from "@tanstack/react-router"
import { createHash } from "node:crypto"
import { skillPath } from "../lib/pages.js"

// The digest the draft requires is a SHA-256 of the bytes each skill URL
// serves. It is computed here, over the body this build generates, so a skill
// cannot be edited without its digest following.
const sha256 = (body: string) => createHash("sha256").update(body, "utf8").digest("hex")

export const Route = createFileRoute("/.well-known/agent-skills/index.json")({
  server: {
    handlers: { GET: () => json(agentSkillsIndex(capabilitySkills(skillPath), sha256)) },
  },
})
