import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"

/*
   The map answers for elements markdown generates — a table, a heading, a
   paragraph. It cannot answer for a tag the content writes itself: MDX emits a
   literal lowercase JSX element as that DOM element and never consults this
   map for it. Content writes `<kbd>Enter</kbd>` by hand, so the key cap is an
   element rule in tokens.css rather than an entry here.
*/
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents
