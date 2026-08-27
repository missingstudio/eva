import { origin } from "@missingstudio/machine"
import { Page } from "./sections.js"
import { site } from "../lib/site.js"

/**
 * The page a wrong URL lands on. It says what happened and offers the way
 * back, because a dead end with no exit is the same defect as a dead link.
 *
 * The second list is the way back for a reader that is not a person. An agent
 * that follows a stale link has one question — where is the index — and three
 * absolute paths answer it without a second request.
 */
export function NotFound() {
  return (
    <Page className="max-w-page mx-auto px-6 pt-24 pb-20">
      <p className="eyebrow mb-8">Error 404</p>
      <h1 className="d-1 max-w-measure">This page is not here.</h1>
      <p className="text-muted-foreground max-w-measure mt-6">
        The address may have changed, or it may never have existed. The documentation search finds
        pages by their contents, which is the quickest way back to what you wanted.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <a className="btn-primary" href="/">
          Go to the home page
        </a>
        <a className="btn-ghost" href={site.doc("")}>
          Search the documentation
        </a>
      </div>

      <h2 className="eyebrow mt-16 mb-4">Where the indexes are</h2>
      <ul className="text-muted-foreground max-w-measure space-y-2 text-sm">
        <li>
          <a className="link-rule hover:text-bone" href="/llms.txt">
            {origin.web}/llms.txt
          </a>{" "}
          — every page and every capability, as one markdown index.
        </li>
        <li>
          <a className="link-rule hover:text-bone" href="/sitemap.xml">
            {origin.web}/sitemap.xml
          </a>{" "}
          — every URL this site serves.
        </li>
        <li>
          <a className="link-rule hover:text-bone" href={`${origin.docs}/llms.txt`}>
            {origin.docs}/llms.txt
          </a>{" "}
          — every documentation page, as markdown.
        </li>
      </ul>
    </Page>
  )
}
