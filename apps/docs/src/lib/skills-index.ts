import { agentSkillsIndex, type DocSlug } from "@missingstudio/ui"
import { pageMarkdown } from "./markdown.js"
import { taught } from "./skills.js"
import { source } from "./source.js"
import { twinOfSlug } from "./twins.js"

/** The body a skill's URL serves, which is the page's own markdown twin. */
const bodyOf = async (slug: DocSlug) => {
  const page = source.getPage(slug === "" ? [] : slug.split("/"))
  if (!page) return undefined

  return pageMarkdown({
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    raw: await page.data.getText("raw"),
  })
}

/**
 * The Agent Skills index: every task these pages teach, as a skill whose body
 * is the page's own markdown twin.
 *
 * The shape is the ui package's, so this index and the marketing origin's
 * carry the draft's five fields under one statement of them. The digest is
 * taken over the twin this build writes, so a page cannot be edited without
 * its digest following, and a skill whose page has gone is dropped rather than
 * published with a digest of nothing.
 */
export const agentSkills = async (sha256: (body: string) => string) => {
  const skills = []

  for (const skill of taught) {
    const body = await bodyOf(skill.slug)
    if (!body) continue

    skills.push({
      name: skill.name,
      description: skill.description,
      url: twinOfSlug(skill.slug),
      body,
    })
  }

  return agentSkillsIndex(skills, sha256)
}
