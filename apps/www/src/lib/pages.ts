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
export const pagePaths = ["", "/changelog", "/privacy"] as const
