import { entity, external } from "@missingstudio/machine"
import type { Prose } from "./prose.js"

/*
  Every channel here is one that exists and is read. There is no support
  mailbox, so this page does not offer one: a published address that bounces
  is worse for a reader than a page that says where the real door is.
*/
export const contact: Prose = {
  title: "Contact",
  description: `How to reach ${entity.company.name} about ${entity.product.name}, and which channel answers what.`,
  lede: "Every question about Eva is answered in public, on the issue tracker.",
  sections: [
    {
      heading: "Questions, bugs, and requests",
      blocks: [
        {
          p: "A question answered in public is answered once, and the next person who asks it finds the answer instead of asking it again. That is why there is an issue tracker and not a support address.",
        },
        {
          p: "Include the version from `eva --version`, the command you ran, and what happened instead. Eva prints findings to stderr without changing the exit code, so paste stderr as well as stdout.",
        },
        { link: { label: "Open an issue", href: external.issues } },
      ],
    },
    {
      heading: "Security",
      blocks: [
        {
          p: "There is no separate security mailbox. Report a suspected vulnerability as an issue that says what the impact is and which code path reaches it, and leave a working exploit out of the first message.",
        },
        {
          p: "If the finding needs to stay private until it is fixed, say so in the first line rather than in the detail, and a private channel will be opened before anything more is written down.",
        },
      ],
    },
    {
      heading: "Changes to the program",
      blocks: [
        {
          p: "The source takes patches. Read the contributing page in the documentation first: it names the commit format, the branch naming, and the checks a change has to pass.",
        },
        { link: { label: "Read the source", href: external.repo } },
        {
          p: "Every release is published with its notes, its checksums, and a provenance attestation.",
        },
        { link: { label: "See the releases", href: external.releases } },
      ],
    },
    {
      heading: "The company",
      blocks: [
        {
          p: `${entity.company.name} publishes Eva. Its other work is on the same organisation, and it posts as @madebymissing.`,
        },
        { link: { label: "missingstudio on GitHub", href: external.org } },
        { link: { label: "@madebymissing on X", href: external.x } },
      ],
    },
  ],
}
