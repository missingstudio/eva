import { entity, external, origin } from "@missingstudio/ui"

/*
  The changelog page keeps its own markup, because it is a heading, a sentence,
  and a link rather than a document. Its words live here so the markdown twin
  and the page say the same three things.
*/
export const changelog = {
  title: "Changelog",
  description: `Every ${entity.product.name} release, and what changed in it.`,
  url: `${origin.web}/changelog`,
  lede: "Every release is published on GitHub with its notes, its checksums, and a provenance attestation.",
  link: { label: "View releases on GitHub", href: `${external.repo}/releases` },
} as const
