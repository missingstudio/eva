import { entity, origin } from "@missingstudio/ui"
import type { Prose } from "./prose.js"

/*
  Everything on this page is a statement about what the code in this repository
  does. It carries no claim that cannot be checked against the tree: the
  typeface is a file in packages/ui/fonts, no cookie is written anywhere, and
  there is no analytics call anywhere in either site. A page that promised
  more than that would be marketing copy.
*/
export const privacy: Prose = {
  title: "Privacy",
  description: `What ${origin.web} stores, and what it sends elsewhere.`,
  lede: "This site stores nothing, sends nothing to a third party, and has no analytics.",
  sections: [
    {
      heading: "No cookies",
      blocks: [
        {
          p: "This site sets no cookie and writes nothing to your browser’s storage. There is no theme control because there is no theme to record: the site is dark only, the same surface the program itself draws.",
        },
      ],
    },
    {
      heading: "What this site does not do",
      blocks: [
        {
          list: [
            "No analytics, no tracking pixel, and no session recording.",
            "No advertising, and no data sold or shared with an advertiser.",
            "No account, and no form that asks for a name or an address.",
            "No third-party fonts or scripts. The typeface is served from this origin, so no other company sees your request.",
          ],
        },
      ],
    },
    {
      heading: "Where a request does leave",
      blocks: [
        {
          p: "Links to GitHub, npm, and the license text go to those companies, and their own policies apply once you follow one. Nothing is sent to them until you do.",
        },
        {
          p: "This site is served by Cloudflare, which processes the request in order to answer it.",
        },
      ],
    },
    {
      heading: "Eva, the program",
      blocks: [
        {
          p: "Eva runs on your machine. It writes its sessions to disk under your home directory and reads a repository’s configuration only after you grant it. This page covers this website; what the program stores is documented with the program.",
        },
      ],
    },
    {
      heading: "Questions",
      blocks: [
        {
          p: `${entity.company.name} publishes this site. Open an issue on the repository and it will be answered in public.`,
        },
      ],
    },
  ],
}
