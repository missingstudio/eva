import { Page } from "./sections.js"
import { site } from "../lib/site.js"

/**
 * The page a wrong URL lands on. It says what happened and offers the way
 * back, because a dead end with no exit is the same defect as a dead link.
 */
export function NotFound() {
  return (
    <Page className="max-w-page mx-auto px-6 pt-24 pb-20">
      <p className="eyebrow mb-8">Error 404</p>
      <h1 className="d-1 max-w-measure">This page is not here.</h1>
      <p className="text-muted max-w-measure mt-6">
        The address may have changed, or it may never have existed. The documentation search finds
        pages by their contents, which is the quickest way back to what you wanted.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <a className="btn-primary" href="/">
          Go to the home page
        </a>
        <a className="btn-secondary" href={site.doc("")}>
          Search the documentation
        </a>
      </div>
    </Page>
  )
}
