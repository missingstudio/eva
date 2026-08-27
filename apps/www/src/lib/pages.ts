/**
 * Every path this site serves, as pages and as files for a machine.
 *
 * This module imports nothing on purpose. `vite.config.ts` reads it, and Vite
 * loads that config through Node rather than through the bundler — so a bare
 * package specifier anywhere in this file's import graph fails the build with
 * an unresolved `.js` that is really a `.ts`. Keeping the list free of imports
 * is what lets one list serve both the application and the build.
 */

/**
 * Every path this site serves as a page. The sitemap reads it, and a test
 * checks it against the route directory, so a new page cannot ship unlisted.
 *
 * No `lastmod` travels with these. The documentation site takes its dates from
 * git because a page there is one file; a page here is a route composed from
 * several components, so any single file's date would be a claim about content
 * it does not own. An absent date costs a crawler nothing. A wrong one teaches
 * it to ignore the dates that are right.
 */
export const pagePaths = ["", "/about", "/changelog", "/contact", "/privacy"] as const

/**
 * The markdown twin of a page. A page and its twin are one document in two
 * representations, so the pairing is a rule rather than a list: the twin of
 * `/about` is `/about.md`, and the home page's twin is `/index.md` because
 * `/.md` is not a path.
 */
export const twinOf = (path: string) => (path === "" ? "/index.md" : `${path}.md`)

/**
 * Where one Agent Skill is served. The Agent Skills discovery draft requires a
 * SKILL.md whose frontmatter `name` matches its parent directory, so the
 * capability's name is the directory and the filename is fixed.
 */
export const skillPath = (name: string) => `/.well-known/agent-skills/${name}/SKILL.md`

/**
 * Files this site serves for a machine to read rather than a person, except
 * the skills, whose names live with the capabilities they describe.
 */
const machineBase = [
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  ...pagePaths.map(twinOf),
  // Neither is a page, so neither has a twin above. An agent comparing tools
  // reads the first; one looking for a credential reads the second.
  "/pricing.md",
  "/auth.md",
  // Agentic Resource Discovery. `ard.json` is the path the current spec names
  // and `ai-catalog.json` is its predecessor, which readers in the field still
  // ask for first. Both are served, and both say the same thing.
  "/.well-known/ard.json",
  "/.well-known/ai-catalog.json",
  "/.well-known/agent-skills/index.json",
]

/**
 * The build's whole work order.
 *
 * TanStack Start's prerender discovers a page by looking for a route with a
 * `component`, and no route in this list has one — they answer with text, not
 * with markup. Without this list those routes exist in the tree, work in
 * `vite dev`, and are absent from the deployed site, which is exactly what
 * happened before it was written.
 *
 * `machine.test.ts` checks it against the route directory in both directions,
 * so a new text route cannot ship unemitted and a listed path cannot point at
 * a route nobody wrote.
 */
export const machinePathsFor = (skillNames: readonly string[]): readonly string[] => [
  ...machineBase,
  ...skillNames.map(skillPath),
]

/** The 404 body, written to the one filename static hosting looks for. */
export const notFoundPath = "/404.html"
