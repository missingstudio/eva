import { capabilities } from "./agents.js"
import { entity, origin } from "./site.js"

/**
 * The Agent Skills index both origins publish, and the shape the discovery
 * draft gives one skill.
 *
 * The two origins publish different skills — the marketing origin publishes
 * what the program can do, and the documentation publishes what its pages
 * teach — but they publish them under one shape. Stating it here is what keeps
 * the schema version, the five required fields, and the digest format from
 * being written down once per origin and corrected once per origin.
 */

/** The version clients match on. */
export const agentSkillsSchema = "https://schemas.agentskills.io/discovery/0.2.0/schema.json"

/** Every field the draft requires of a skill, in the order a test compares. */
export const agentSkillFields = ["description", "digest", "name", "type", "url"] as const

/** One skill, as the index lists it. */
export type AgentSkill = {
  name: string
  type: "skill-md" | "archive"
  description: string
  url: string
  digest: string
}

/**
 * What a skill is, before the index states it: a name, what it is for, where
 * its body is served, and the body itself.
 */
export type SkillSource = {
  name: string
  description: string
  url: string
  body: string
}

/**
 * The index document.
 *
 * The digest is computed over the body the caller passes rather than written
 * down, because a digest maintained by hand is a digest that is wrong. The
 * hasher is a parameter because hashing belongs to the runtime, and this
 * module is read by a build as well as by a route.
 */
export const agentSkillsIndex = (
  skills: readonly SkillSource[],
  sha256: (body: string) => string,
) => ({
  $schema: agentSkillsSchema,
  skills: skills.map(
    (skill): AgentSkill => ({
      name: skill.name,
      // The draft defines two. Every skill either origin publishes is a
      // SKILL.md; neither ships an archive.
      type: "skill-md",
      description: skill.description,
      url: skill.url,
      digest: `sha256:${sha256(skill.body)}`,
    }),
  ),
})

const lines = (parts: string[]) => `${parts.join("\n")}\n`

/**
 * What a capability's skill says it is for. The draft asks the index's
 * description to match the SKILL.md frontmatter, so one function writes both
 * and they cannot disagree. A description says what the skill does and when to
 * reach for it.
 */
export const capabilityDescription = (capability: (typeof capabilities)[number]) =>
  `${capability.description} Use when working with ${entity.product.name}, the open-source autonomous software factory.`

/**
 * One capability as a SKILL.md. The frontmatter `name` must equal the parent
 * directory's name, which is why the capability's name is both.
 */
export const capabilitySkill = (name: string): string | undefined => {
  const capability = capabilities.find((entry) => entry.name === name)
  if (!capability) return undefined

  return lines([
    "---",
    `name: ${capability.name}`,
    `description: ${capabilityDescription(capability)}`,
    "license: MIT",
    "metadata:",
    `  homepage: ${origin.web}`,
    "---",
    "",
    `# ${capability.title}`,
    "",
    capability.description,
    "",
    "## Run it",
    "",
    "```sh",
    capability.command,
    "```",
    "",
    "Eva runs on the machine that calls it. There is no hosted endpoint and no key",
    "to request: a model credential is read from the environment of the shell that",
    "runs the command.",
    "",
    "## Read more",
    "",
    `${origin.docs}/${capability.slug}`,
  ])
}

/**
 * Every capability, as skills for the origin that publishes them.
 *
 * The URL is a parameter because the path rule belongs to the site that serves
 * the skills, in a module this package may not be imported into.
 */
export const capabilitySkills = (urlOf: (name: string) => string): SkillSource[] =>
  capabilities.map((capability) => ({
    name: capability.name,
    description: capabilityDescription(capability),
    url: urlOf(capability.name),
    body: capabilitySkill(capability.name)!,
  }))
