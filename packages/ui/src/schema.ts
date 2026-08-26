import { entity, external, origin } from "./site.js"

// JSON-LD. Two nodes, each with a stable @id, referencing each other rather
// than repeating themselves. The @id values are apex URLs on both domains, so
// the two sites resolve to one company and one product instead of two of each.
const id = {
  company: `${origin.web}/#organization`,
  product: `${origin.web}/#eva`,
  website: `${origin.web}/#website`,
} as const

type Node = Record<string, unknown>

export const companyNode = (): Node => ({
  "@type": "Organization",
  "@id": id.company,
  name: entity.company.name,
  description: entity.company.description,
  url: origin.web,
  // The organisation points at the GitHub org. The product points at the
  // repository and the package. Pointing both at the same URLs is what
  // merges a company into its product.
  sameAs: [external.org],
})

export const productNode = (version?: string): Node => ({
  "@type": "SoftwareApplication",
  "@id": id.product,
  name: entity.product.name,
  description: entity.product.tagline,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux",
  ...(version ? { softwareVersion: version } : {}),
  downloadUrl: `${origin.web}/install.sh`,
  license: external.license,
  // One product, one way to get it, for now. The managed service arrives as
  // a second offer beside this one — never as a second product.
  offers: [
    {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      category: "open source, self-hosted",
    },
  ],
  publisher: { "@id": id.company },
  sameAs: [external.repo, external.npm],
})

export const websiteNode = (): Node => ({
  "@type": "WebSite",
  "@id": id.website,
  name: entity.product.name,
  url: origin.web,
  publisher: { "@id": id.company },
})

export const homeGraph = (version?: string) => ({
  "@context": "https://schema.org",
  "@graph": [companyNode(), productNode(version), websiteNode()],
})

export const docPageGraph = (page: {
  title: string
  description: string
  url: string
  modified?: string
}) => ({
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: page.title,
  description: page.description,
  url: page.url,
  ...(page.modified ? { dateModified: page.modified } : {}),
  isPartOf: { "@type": "WebSite", name: "Eva documentation", url: origin.docs },
  about: { "@id": id.product },
  publisher: { "@id": id.company },
})

/**
 * A page that defines terms, as terms rather than as prose. An answer engine
 * asked "what is a harness" can lift one definition without inferring where it
 * starts and stops, which a bold run inside a paragraph does not tell it.
 */
export const glossaryGraph = (
  page: { title: string; url: string },
  terms: { term: string; definition: string }[],
) => {
  const set = `${page.url}#glossary`

  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": set,
    name: page.title,
    url: page.url,
    about: { "@id": id.product },
    publisher: { "@id": id.company },
    hasDefinedTerm: terms.map(({ term, definition }) => ({
      "@type": "DefinedTerm",
      name: term,
      description: definition,
      inDefinedTermSet: { "@id": set },
    })),
  }
}

export const breadcrumbGraph = (trail: { name: string; url: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((crumb, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: crumb.name,
    item: crumb.url,
  })),
})

export const faqGraph = (entries: { question: string; answer: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: entries.map((entry) => ({
    "@type": "Question",
    name: entry.question,
    acceptedAnswer: { "@type": "Answer", text: entry.answer },
  })),
})

export const schemaIds = id
