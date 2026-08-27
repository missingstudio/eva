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
