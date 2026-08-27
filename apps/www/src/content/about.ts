import { entity, external } from "@missingstudio/machine"
import type { Prose } from "./prose.js"

/*
  The page an answer engine reads before it decides whether to recommend Eva.
  It says who publishes the program, what the program does today, and what it
  does not do yet. The last part is the part that makes the rest credible, so
  nothing here is softened into a promise.
*/
export const about: Prose = {
  title: "About",
  description: `Who publishes ${entity.product.name}, what it does today, and what it does not do yet.`,
  // The tagline starts a sentence of its own. Here it continues one.
  lede: `${entity.product.name} is ${entity.product.tagline.replace(/^./, (c) => c.toLowerCase())}`,
  sections: [
    {
      heading: "What Eva is",
      blocks: [
        {
          p: "Eva runs coding work end to end — from a spec a machine can check, through a harness that does the work, to evidence that it was done. It ships its own harness and is built to drive the ones you already pay for behind one contract, with one trace, one verifier, and one bill.",
        },
        {
          p: "Eva runs on your laptop as a command-line program, and as a service you reach from anywhere. Those are the same program, not two products with a shared name.",
        },
      ],
    },
    {
      heading: "What works today",
      blocks: [
        {
          p: "Eva answers a prompt at a terminal and runs a declared Workflow, on a plugin kernel: a small core loads plugins, and every capability — the model, the surface, the trace, the themes, the Workflow itself — is one of them.",
        },
        {
          list: [
            "A terminal console, and a print mode that answers once and exits with a real code.",
            "Durable sessions. Everything Eva shows is folded from a trace on disk, so a session survives a crash.",
            "Cost accounting. Eva records what a provider said a request cost, and marks an estimate as an estimate.",
            "A trust boundary. Eva reads a repository’s configuration only after someone grants it.",
          ],
        },
      ],
    },
    {
      heading: "What does not work yet",
      blocks: [
        {
          p: "There is no agent loop that plans and acts on its own, and nothing verifies work beyond the shape of it. Racing one spec across several harnesses, unattended overnight runs, and the verifier that decides whether work passed are all on the roadmap rather than in the program.",
        },
        {
          p: "Eva serves no public HTTP API. It is a local-first program, so there is no hosted endpoint to call and no key to obtain.",
        },
      ],
    },
    {
      heading: "Who publishes it",
      blocks: [
        {
          p: `${entity.company.name} is the company behind Eva. Its first product is Eva as a managed service — the same tree, operated for you. Self-hosting is not a downgrade path, and there is no paid tier that unlocks capability.`,
        },
        {
          p: "Eva is MIT licensed and the whole tree is public. Every release is published with its notes, its checksums, and a provenance attestation.",
        },
        { link: { label: "Read the source", href: external.repo } },
      ],
    },
  ],
}
