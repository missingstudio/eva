import { entity, external, type DocSlug } from "@missingstudio/ui"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@missingstudio/ui/components/sheet"
import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { faq } from "./faq.js"
import { Install } from "./install.js"
import { armReveals } from "./reveal.js"
import { lede, openSource, today } from "../content/home.js"
import { site, siteData } from "../lib/site.js"
import backdrop from "../../../../assets/sea.webp"

const doc = (slug: DocSlug) => site.doc(slug)

const step = (index: number) => ({ "--reveal-index": index }) as CSSProperties

// The hero sets the tagline on two lines. The break falls after the second word.
const taglineLines = (tagline: string) => {
  const words = tagline.split(" ")
  return [words.slice(0, 2).join(" "), words.slice(2).join(" ")]
}

export function Reveals() {
  useEffect(() => armReveals(), [])
  return null
}

/**
 * The first focusable element on the page. It is visually hidden until it
 * takes focus, and then it is the first thing a keyboard reader sees.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="btn-secondary sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
    >
      Skip to content
    </a>
  )
}

/**
 * The page shell. Every page on this surface is built from it, so the skip
 * link, the navigation and the footer cannot drift apart between pages.
 *
 * The column is at least the viewport tall and the main region takes the
 * slack, which is what puts the footer at the foot of a short page. Without
 * it the footer stops where the content stops, and a closing band floating in
 * the middle of the screen does not read as a footer at all.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <Nav />
      <main id="main" className={`flex-1 ${className ?? ""}`}>
        {children}
      </main>
      <Footer />
    </div>
  )
}

function Section({
  children,
  label,
  beat = "section-y",
}: {
  children: ReactNode
  label?: string
  beat?: "section-y" | "section-y-lg" | "section-y-tight"
}) {
  return (
    <section className="border-graphite border-t">
      <div className={`max-w-page relative mx-auto px-6 ${beat}`}>
        {label ? <p className="eyebrow reveal mb-8">{label}</p> : null}
        {children}
      </div>
    </section>
  )
}

const menu = [
  { label: "Docs", href: doc("") },
  { label: "Roadmap", href: doc("about/roadmap") },
  { label: "Changelog", href: "/changelog" },
  { label: "GitHub", href: external.repo },
]

/**
 * The navigation bar — one docked bar on the void with a hairline below.
 * Below 768px it collapses to a wordmark and a hamburger that rotates into a
 * true X, and the menu opens as a screen-filling overlay.
 *
 * That overlay is a modal dialog, and the package's Sheet is the one that says
 * so. What was written by hand here cycled Tab and restored focus, but the
 * panel carried no `role` at all, nothing marked the page behind it inert, and
 * nothing locked the scroll — so the menu read as a plain div and the document
 * under it stayed live. Base UI's dialog brings `role="dialog"`, a labelled
 * title, focus-guard sentinels either side of the panel, an internal backdrop
 * that swallows pointer events, and the scroll lock. It does this with inert
 * markers rather than `aria-modal`, which it reserves for toasts.
 *
 * Sheet is the one disclosure that needs no animation library: it moves on
 * `data-starting-style` and `data-ending-style`, which are plain transitions,
 * where Dialog reaches for tw-animate-css. The motion contract in motion.css
 * forbids the second, so the choice is made for us.
 *
 * `side="top"` is the closest of the four to a full-screen menu, and it slides
 * down from the bar the button sits in. Everything it assumes about a side
 * panel — a height that fits its content, an edge border, a shadow, a width —
 * is turned off at the same variant, so the override actually lands.
 */
export function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <div className="sticky top-0 z-40">
      {/*
        One docked bar on the void, a hairline below — no island, no pill.
        The gaps follow the group rule: 4px inside the link row, 12px between
        groups, so the row reads as three things rather than seven.
      */}
      <nav
        aria-label="Main"
        className="border-graphite bg-void/80 flex w-full items-center gap-3 border-b px-4 py-2 backdrop-blur-lg"
      >
        <a href="/" aria-label="Eva, home" className="flex items-center py-1">
          {/* The wordmark from the brand kit, inverted onto the void. */}
          <img src="/brand/wordmark.svg" alt="Eva" width={66} height={20} className="invert" />
        </a>

        <div className="hidden items-center gap-1 md:ml-auto md:flex">
          {menu.map((item) => (
            <a key={item.label} className="btn-header" href={item.href}>
              {item.label}
              {item.label === "GitHub" && siteData.stars ? (
                <span className="tnum text-muted-foreground">
                  {" "}
                  ★ {siteData.stars.toLocaleString()}
                </span>
              ) : null}
            </a>
          ))}
        </div>

        {/* The one ember button on the page, at the row's own step. */}
        <a className="btn-primary btn-sm hidden md:inline-flex" href={doc("install")}>
          Install Eva
        </a>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <button
                type="button"
                aria-label={open ? "Close the menu" : "Open the menu"}
                className="btn-icon md:hidden"
              />
            }
          >
            {/* The morph is the `.hamburger` component, driven by aria-expanded. */}
            <span aria-hidden="true" className="hamburger">
              <span />
              <span />
            </span>
          </SheetTrigger>

          <SheetContent
            side="top"
            showCloseButton={false}
            className="bg-void/80 justify-center gap-2 px-6 shadow-none backdrop-blur-3xl duration-(--dur-fast) ease-(--ease-fluid) md:hidden data-[side=top]:h-dvh data-[side=top]:border-0"
          >
            <SheetTitle className="sr-only">Menu</SheetTitle>
            {menu.map((item, index) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="d-3 menu-item py-2"
                style={step(index)}
              >
                {item.label}
              </a>
            ))}
            <div className="menu-item mt-6 flex items-center gap-3" style={step(menu.length)}>
              <a
                className="btn-primary btn-sm"
                href={doc("install")}
                onClick={() => setOpen(false)}
              >
                Install Eva
              </a>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  )
}

export function Hero() {
  return (
    <header className="border-graphite border-b">
      <div className="max-w-page relative mx-auto px-6 pt-20 pb-16 sm:pt-28">
        {/*
          The tagline is one string in the ui package. The site never
          restates it in its own words, so the headline splits that string
          rather than spelling the words out again.

          Where it breaks is editorial, not whatever the box decides, so the
          two lines are two blocks. A box too narrow for the second line adds
          a line below the break, but nothing moves the break itself.
        */}
        <h1 className="d-hero reveal max-w-hero">
          {taglineLines(entity.product.tagline).map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

        <p className="lede reveal max-w-measure mt-6">{lede}</p>

        <div className="reveal mt-10">
          <Install version={siteData.version} />
        </div>

        <p className="text-muted-foreground reveal mt-4 text-xs">
          <a className="link-rule hover:text-bone inline-block py-1" href={doc("install")}>
            Every channel, and how to verify a download →
          </a>
        </p>
      </div>
    </header>
  )
}

/*
  The capture is a window on a transparent margin. On a panel of the same
  near-black it read as an empty box with a hairline around the padding, so
  the window sits on a backdrop instead — the way a window sits on a desktop.
  The band is the image now, so the band carries the edge, and the window
  keeps the border it was captured with.
*/
export function Screenshot({ src }: { src: string }) {
  return (
    <Section label="The console" beat="section-y-tight">
      <Harnesses />

      <div className="image-edge reveal relative isolate overflow-hidden rounded-xl">
        <img src={backdrop} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
        <div className="p-4 sm:p-10 lg:p-16">
          <img
            src={src}
            alt="Eva answering a question in the terminal"
            width={2048}
            height={1152}
            className="w-full"
          />
        </div>
      </div>
    </Section>
  )
}

export function Today() {
  return (
    <Section label="What Eva does today">
      <h2 className="d-1 reveal max-w-measure mb-10">Shipping, and provable.</h2>
      <div className="reveal-group grid gap-4 sm:grid-cols-2">
        {today.map((row, index) => (
          <a
            key={row.title}
            href={doc(row.slug)}
            className="card-hairline reveal group block p-6"
            style={step(index)}
          >
            <h3 className="d-3">{row.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm">{row.body}</p>
            <span className="text-muted-foreground group-hover:text-bone mt-4 inline-block text-xs">
              Read →
            </span>
          </a>
        ))}
      </div>
    </Section>
  )
}

/*
  The marks ship as `currentColor` SVGs, but an `<img>` cannot inherit colour.
  Each one is painted as a mask over the text colour instead, so a harness sits
  at the muted ink in both schemes and comes up to full ink on hover.
*/
const harnesses = [
  { name: "Amp", mark: "amp" },
  { name: "Claude Code", mark: "claude" },
  { name: "Codex", mark: "openai" },
  { name: "Cursor", mark: "cursor" },
  { name: "OpenCode", mark: "opencode" },
  { name: "Grok", mark: "grok" },
  { name: "Pi", mark: "pi" },
]

const mark = (file: string): CSSProperties => ({
  maskImage: `url(/harnesses/${file}.svg)`,
  WebkitMaskImage: `url(/harnesses/${file}.svg)`,
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskPosition: "center",
})

export function Harnesses() {
  return (
    <div className="mb-10">
      <ul className="reveal-group flex flex-wrap items-center gap-x-10 gap-y-6">
        {harnesses.map(({ name, mark: file }, index) => (
          <li key={name} className="reveal" style={step(index)}>
            <span
              role="img"
              aria-label={name}
              className="text-muted-foreground hover:text-bone block size-7 bg-current transition-colors duration-[var(--dur-instant)] ease-[var(--ease-fluid)]"
              style={mark(file)}
            />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground reveal max-w-measure mt-6 text-sm">
        Eva drives its own harness today. The adapters that put the harnesses you already pay for
        behind the same contract.
      </p>
    </div>
  )
}

export function OpenSource() {
  return (
    <Section label="Local-first, and open" beat="section-y-lg">
      <div className="grid gap-10 sm:grid-cols-2">
        <h2 className="d-2 reveal">{openSource.heading}</h2>
        <div className="reveal space-y-4">
          {openSource.body.map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground max-w-measure text-sm">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </Section>
  )
}

export function Faq() {
  return (
    <Section label="Questions">
      <div className="border-graphite reveal-group border-t">
        {faq.map((entry, index) => (
          <details
            key={entry.question}
            className="border-graphite reveal group border-b py-5"
            style={step(index)}
          >
            {/*
              `list-none` removes the native marker, so a chevron is supplied
              in its place. Open and closed must differ by more than colour.
            */}
            <summary className="flex cursor-pointer list-none items-center gap-3 font-medium tracking-tight transition-colors duration-[var(--dur-instant)] ease-[var(--ease-fluid)]">
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="size-3 shrink-0 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-fluid)] group-open:rotate-90"
              >
                <path
                  d="M6 3.5 10.5 8 6 12.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {entry.question}
            </summary>
            <p className="text-muted-foreground max-w-measure mt-3 ml-6 text-sm">{entry.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}

export function Close() {
  return (
    <Section beat="section-y-lg">
      <h2 className="d-1 reveal">Run it now.</h2>
      <div className="reveal mt-8">
        <Install version={siteData.version} />
      </div>
    </Section>
  )
}

export function Footer() {
  return (
    <footer className="border-graphite border-t">
      <div className="text-muted-foreground max-w-page mx-auto flex flex-wrap items-center gap-x-6 px-6 py-10 text-xs">
        <a className="link-rule hover:text-bone inline-block py-1" href={doc("")}>
          Docs
        </a>
        <a className="link-rule hover:text-bone inline-block py-1" href={doc("about/roadmap")}>
          Roadmap
        </a>
        <a className="link-rule hover:text-bone inline-block py-1" href="/changelog">
          Changelog
        </a>
        <a className="link-rule hover:text-bone inline-block py-1" href={external.repo}>
          GitHub
        </a>
        <a className="link-rule hover:text-bone inline-block py-1" href="/privacy">
          Privacy
        </a>
        <a className="link-rule hover:text-bone inline-block py-1" href={external.license}>
          MIT license
        </a>
        <span className="ml-auto">
          © {new Date().getFullYear()} {entity.company.name}
        </span>
      </div>
    </footer>
  )
}
