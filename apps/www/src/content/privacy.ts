import { entity, origin } from "@missingstudio/machine"
import type { Prose } from "./prose.js"

/*
  Everything on this page is a statement about what the code in this repository
  does. It carries no claim that cannot be checked against the tree: the
  typeface is a file in packages/ui/fonts, and the one third-party script is
  the Google Analytics tag in src/routes/__root.tsx. A page that promised more
  than that would be marketing copy.
*/
export const privacy: Prose = {
  title: "Privacy",
  description: `What ${origin.web} stores, and what it sends elsewhere.`,
  lede: "This site counts page views with Google Analytics, and does nothing else with you.",
  sections: [
    {
      heading: "What this site measures",
      blocks: [
        {
          p: "Every page loads the Google Analytics tag, which reports the visit: the address of the page, the page you arrived from, and what a browser tells any server about itself — its language, its screen, and an approximate location worked out from the network address. Google holds that record; missing studio reads the totals.",
        },
        {
          p: "Those totals answer one question, which is which pages people read. Nothing on this site asks who you are, so there is no name to attach to a visit and nothing is joined to a record held elsewhere.",
        },
        {
          p: "Block googletagmanager.com and every page still works the same.",
        },
      ],
    },
    {
      heading: "Cookies",
      blocks: [
        {
          p: "Google Analytics writes two cookies, _ga and _ga_349PSFMKTG. They tell one browser from another and one visit from the next, so a reader who comes back is not counted as a new one.",
        },
        {
          p: "Nothing else writes to your browser’s storage. There is no theme control because there is no theme to record: the site is dark only, the same surface the program itself draws.",
        },
      ],
    },
    {
      heading: "What this site does not do",
      blocks: [
        {
          list: [
            "No advertising, and no data sold or shared with an advertiser.",
            "No session recording, and no map of what you click.",
            "No account, and no form that asks for a name or an address.",
            "No third-party font. The typeface is served from this origin, so no other company sees that request.",
          ],
        },
      ],
    },
    {
      heading: "Where a request does leave",
      blocks: [
        {
          p: "Google receives the analytics request described above, and its own policy governs what it does with it.",
        },
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
          p: "Eva runs on your machine and reports nothing to anybody. It writes its sessions to disk under your home directory and reads a repository’s configuration only after you grant it. This page covers this website; what the program stores is documented with the program.",
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
