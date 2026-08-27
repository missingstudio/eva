import {
  agentSkillsIndex,
  aiCatalogManifest,
  ardManifest,
  capabilities,
  catalogEntry,
  entity,
  origin,
} from "@missingstudio/machine"
import dedent from "dedent"
import { skillPath } from "./pages.js"

/**
 * What this site tells an agent it offers, before the agent reads a word of
 * prose. The catalog entries come from the ui package, because the
 * documentation site catalogues some of the same resources and a resource has
 * one identifier wherever it is listed.
 *
 * Nothing here names a surface Eva does not serve. That rules out an A2A agent
 * card: its `supportedInterfaces` is a required field whose entries must be
 * live HTTPS agent endpoints, and Eva is a local program with none. A card
 * with an endpoint that refuses the connection is worse than no card, because
 * an agent spends a call to learn what the card should have told it.
 */

// The marketing origin catalogues the product: what it is, what it costs, what
// it can do, and where its documentation and source are.
const entries = () => [
  catalogEntry.docsIndex(),
  catalogEntry.siteIndex(),
  catalogEntry.skills(),
  catalogEntry.pricing(),
  catalogEntry.auth(),
  catalogEntry.source(),
]

export const ard = () => ardManifest(entries())
export const aiCatalog = () => aiCatalogManifest(entries())

/**
 * What a skill says it is for. The draft asks the index's description to match
 * the SKILL.md frontmatter, so one function writes both and they cannot
 * disagree. A description says what the skill does and when to reach for it.
 */
const skillDescription = (capability: (typeof capabilities)[number]) =>
  `${capability.description} Use when working with ${entity.product.name}, the open-source autonomous software factory.`

/**
 * One Agent Skill, as a SKILL.md. The frontmatter `name` must equal the parent
 * directory's name, which is why the capability's name is both.
 */
export const skill = (name: string): string | undefined => {
  const capability = capabilities.find((entry) => entry.name === name)
  if (!capability) return undefined

  return `${dedent`
    ---
    name: ${capability.name}
    description: ${skillDescription(capability)}
    license: MIT
    metadata:
      homepage: ${origin.web}
    ---

    # ${capability.title}

    ${capability.description}

    ## Run it

    \`\`\`sh
    ${capability.command}
    \`\`\`

    Eva runs on the machine that calls it. There is no hosted endpoint and no key
    to request: a model credential is read from the environment of the shell that
    runs the command.

    ## Read more

    ${origin.docs}/${capability.slug}
  `}\n`
}

/**
 * The Agent Skills index: every capability, as a skill whose body this origin
 * generates and serves.
 *
 * The shape is the ui package's, because the documentation origin publishes an
 * index too and the draft's five fields are the draft's wherever they are
 * written. What differs is the list — this one is what the program can do —
 * and the body a digest is taken over.
 *
 * One index of these, on this origin only. The documentation's catalog points
 * at it rather than publishing a second copy: two indexes carrying digests of
 * the same bytes are two things to keep right.
 */
export const agentSkills = (sha256: (body: string) => string) =>
  agentSkillsIndex(
    capabilities.map((capability) => ({
      name: capability.name,
      description: skillDescription(capability),
      url: skillPath(capability.name),
      body: skill(capability.name)!,
    })),
    sha256,
  )
