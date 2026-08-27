import { origin } from "@missingstudio/machine"

/**
 * The page a wrong documentation URL lands on. It says what happened and
 * offers the way back, because a dead end with no exit is the same defect as
 * a dead link.
 *
 * The second list is the way back for a reader that is not a person. An agent
 * that followed a stale link has one question — where is the index — and these
 * answer it without a second guess.
 */
export function NotFound() {
  return (
    <main id="nd-page" className="max-w-page mx-auto px-6 pt-24 pb-20">
      <p className="eyebrow mb-8">Error 404</p>
      <h1 className="d-1 max-w-measure">This page is not here.</h1>
      <p className="text-muted-foreground max-w-measure mt-6">
        The address may have changed, or it may never have existed. Search finds pages by their
        contents, which is the quickest way back to what you wanted.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <a className="btn-primary" href="/">
          Go to the documentation home
        </a>
      </div>

      <h2 className="eyebrow mt-16 mb-4">Where the indexes are</h2>
      <ul className="text-muted-foreground max-w-measure space-y-2 text-sm">
        <li>
          <a className="link-rule hover:text-bone" href="/llms.txt">
            {origin.docs}/llms.txt
          </a>{" "}
          — every documentation page, as markdown.
        </li>
        <li>
          <a className="link-rule hover:text-bone" href="/sitemap.xml">
            {origin.docs}/sitemap.xml
          </a>{" "}
          — every URL this site serves.
        </li>
        <li>
          <a className="link-rule hover:text-bone" href={`${origin.web}/llms.txt`}>
            {origin.web}/llms.txt
          </a>{" "}
          — what Eva is, and when to reach for it.
        </li>
      </ul>
      <p className="text-muted-foreground max-w-measure mt-4 text-sm">
        Every page here is also served as markdown at the same path with <code>.md</code> appended.
      </p>
    </main>
  )
}
