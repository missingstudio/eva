import { json } from "@missingstudio/ui/serve"
import { createFileRoute } from "@tanstack/react-router"
import { createHash } from "node:crypto"
import { agentSkills } from "../lib/skills-index.js"

// The digest the draft requires is a SHA-256 of the bytes each skill URL
// serves, and each skill's URL is a page's own markdown twin.
const sha256 = (body: string) => createHash("sha256").update(body, "utf8").digest("hex")

export const Route = createFileRoute("/.well-known/agent-skills/index.json")({
  server: { handlers: { GET: async () => json(await agentSkills(sha256)) } },
})
