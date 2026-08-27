import { Fragment } from "react"
import type { Block, Prose } from "../content/prose.js"
import { Page } from "./sections.js"

// A block has no identity of its own, so its own words are the key.
const keyOf = (block: Block) =>
  "list" in block
    ? block.list.join("")
    : "code" in block
      ? block.code
      : "link" in block
        ? block.link.href
        : block.p

function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return blocks.map((block) => (
    <Fragment key={keyOf(block)}>
      {"list" in block ? (
        <ul className="text-muted-foreground max-w-measure mt-4 space-y-2">
          {block.list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : "code" in block ? (
        <pre className="panel-terminal max-w-measure mt-4 overflow-x-auto rounded-xl p-4">
          <code className="text-code">{block.code}</code>
        </pre>
      ) : "link" in block ? (
        // The one link style this surface has, set by the changelog page.
        <p className="mt-4 text-sm">
          <a className="text-bone underline underline-offset-4" href={block.link.href}>
            {block.link.label} →
          </a>
        </p>
      ) : (
        <p className="text-muted-foreground max-w-measure mt-4">{block.p}</p>
      )}
    </Fragment>
  ))
}

/**
 * The one renderer for every page that is mostly words. The privacy page set
 * this markup; about, contact and pricing follow it, so the four pages cannot
 * drift into four layouts.
 *
 * Sections are fragments rather than wrappers. A `div` around a heading and
 * its paragraphs would render the same today and is one stray padding rule
 * away from not doing so.
 */
export function ProsePage({ prose }: { prose: Prose }) {
  return (
    <Page className="max-w-page mx-auto px-6 pt-24 pb-20">
      <h1 className="d-1 max-w-measure">{prose.title}</h1>
      <p className="lede max-w-measure mt-6">{prose.lede}</p>

      {prose.sections.map((section) => (
        <Fragment key={section.heading}>
          <h2 className="d-2 max-w-measure mt-16">{section.heading}</h2>
          <Blocks blocks={section.blocks} />
        </Fragment>
      ))}
    </Page>
  )
}
