import { entity, external, type DocSlug } from "@missingstudio/eva-brand"
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { faq } from "./faq.js"
import { Install } from "./install.js"
import { armReveals } from "./reveal.js"
import { ThemeControl } from "./theme-toggle.js"
import { site, siteData } from "../lib/site.js"

const doc = (slug: DocSlug) => site.doc(slug)

const step = (index: number) => ({ "--reveal-index": index }) as CSSProperties

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
  tone,
}: {
  children: ReactNode
  label?: string
  beat?: "section-y" | "section-y-lg" | "section-y-tight"
  tone?: "grid"
}) {
  return (
    <section className={`border-rule border-t ${tone === "grid" ? "grid-surface" : ""}`}>
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
 * The navigation island — a detached pill below the top edge rather than a
 * docked bar. Below 768px it collapses to a wordmark and a hamburger that
 * rotates into a true X, and the menu opens as a screen-filling overlay.
 */
export function Nav() {
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const overlay = useRef<HTMLDivElement>(null)

  // While the overlay is open it owns the keyboard: Escape closes it, Tab
  // cycles inside it, and closing puts focus back on the control that opened
  // it. Without the restore, focus falls to the top of the document.
  useEffect(() => {
    if (!open) return

    const focusable = () => [
      ...(overlay.current?.querySelectorAll<HTMLElement>("a[href], button") ?? []),
    ]

    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        toggle.current?.focus()
        return
      }
      if (event.key !== "Tab") return

      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <div className="sticky top-0 z-40">
      {/*
        Padding on a pill is not padding on a rectangle. The end caps curve
        away, so a control set 8px from the widest point sits about 1px from
        the edge at its own top corner, which is what made the CTA look wedged
        in. 16px either side clears the curve at the corner as well.

        The gaps follow the group rule: 4px inside the link row, 12px between
        groups, so the row reads as four things rather than seven.
      */}
      <nav
        aria-label="Main"
        className="border-rule bg-card mx-auto mt-6 flex w-max max-w-[calc(100%-var(--eva-gutter)*2)] items-center gap-3 rounded-full border px-4 py-2"
      >
        <a href="/" aria-label="Eva, home" className="flex items-center py-1">
          {/* The wordmark from the brand kit, inheriting the text colour. */}
          <img src="/brand/wordmark.svg" alt="Eva" width={66} height={20} className="dark:invert" />
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {menu.map((item) => (
            <a key={item.label} className="btn-header" href={item.href}>
              {item.label}
              {item.label === "GitHub" && siteData.stars ? (
                <span className="tnum text-muted"> ★ {siteData.stars.toLocaleString()}</span>
              ) : null}
            </a>
          ))}
        </div>

        <div className="hidden md:block">
          <ThemeControl />
        </div>

        {/* The one accent button on the page, at the row's own step. */}
        <a className="btn-accent btn-sm hidden md:inline-flex" href={doc("install")}>
          Install Eva
        </a>

        <button
          ref={toggle}
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-label={open ? "Close the menu" : "Open the menu"}
          className="btn-icon md:hidden"
        >
          {/* The morph is the `.hamburger` component, driven by aria-expanded. */}
          <span aria-hidden="true" className="hamburger">
            <span />
            <span />
          </span>
        </button>
      </nav>

      {open ? (
        <div ref={overlay} className="bg-bg/80 fixed inset-0 z-50 backdrop-blur-3xl md:hidden">
          <div className="flex min-h-dvh flex-col justify-center gap-2 px-6">
            {menu.map((item, index) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="d-3 menu-item hover:text-accent py-2"
                style={step(index)}
              >
                {item.label}
              </a>
            ))}
            <div className="menu-item mt-6 flex items-center gap-3" style={step(menu.length)}>
              <ThemeControl />
              <a className="btn-accent btn-sm" href={doc("install")} onClick={() => setOpen(false)}>
                Install Eva
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function Hero() {
  return (
    <header className="grid-surface border-rule border-b">
      <div className="max-w-page relative mx-auto px-6 pt-20 pb-16 sm:pt-28">
        {/*
          The tagline is one string in the brand package. The site never
          restates it in its own words, so the headline reads it rather than
          spelling it out again.
        */}
        <h1 className="d-hero heading-gradient reveal max-w-measure">{entity.product.tagline}</h1>

        <p className="lede reveal max-w-measure mt-6">
          A local-first control center for coding agents. They run in parallel, and they ship
          without losing context.
        </p>

        <div className="reveal mt-10">
          <Install version={siteData.version} />
        </div>

        <p className="text-muted reveal mt-4 text-xs">
          <a className="link-rule hover:text-ink inline-block py-1" href={doc("install")}>
            Every channel, and how to verify a download →
          </a>
        </p>
      </div>
    </header>
  )
}

/**
 * The tagline band. Its own moment further down the page, never stacked under
 * the hero. Each word comes up to full colour as it crosses the trigger line,
 * in reading order, so the block never flips at once.
 */
export function Tagline() {
  const lines = ["Agents make claims.", "Eva keeps the evidence."]
  let running = 0

  return (
    <Section beat="section-y-lg">
      <p className="d-2 max-w-measure reveal-group">
        {lines.map((line) => (
          <span key={line} className="block">
            {line.split(" ").map((word) => (
              <span key={`${line}-${word}`} className="word" style={step(running++)}>
                {word}{" "}
              </span>
            ))}
          </span>
        ))}
      </p>
    </Section>
  )
}

export function Screenshot({ src }: { src: string }) {
  return (
    <Section label="The console" beat="section-y-tight">
      <Harnesses />

      <div className="panel-terminal reveal overflow-hidden rounded-xl p-2">
        <img
          src={src}
          alt="Eva answering a question in the terminal"
          width={2400}
          height={1400}
          className="image-edge w-full rounded-lg"
        />
      </div>
    </Section>
  )
}

const today = [
  {
    title: "Every capability is a plugin",
    body: "A small kernel loads plugins. The model, the surface, the trace, the themes — each one is a plugin, and any of them can be replaced or switched off.",
    slug: "extend/how-plugins-work" as DocSlug,
  },
  {
    title: "A session survives kill -9",
    body: "Everything Eva shows is folded from a durable trace on disk. There is no in-memory state a crash could lose, because there is none that matters.",
    slug: "use/sessions" as DocSlug,
  },
  {
    title: "You can see what a run cost",
    body: "Eva records what the provider said a request cost, in integer ticks. It marks an estimate as an estimate, and never multiplies tokens by a rate and calls it a cost.",
    slug: "use/cost" as DocSlug,
  },
  {
    title: "A repository earns its trust",
    body: "Eva reads a project's .eva directory only after you run eva trust there. The grant is a verb you type, not a file a repository can ship.",
    slug: "configure/trust" as DocSlug,
  },
]

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
            <h3 className="text-lg font-semibold tracking-tight">{row.title}</h3>
            <p className="text-muted mt-2 text-sm">{row.body}</p>
            <span className="text-muted group-hover:text-accent mt-4 inline-block text-xs">
              Read →
            </span>
          </a>
        ))}
      </div>
    </Section>
  )
}

const ones = [
  {
    title: "One contract",
    body: "Every harness behind the same interface, so a task runs on any of them without being rewritten.",
    stage: "stage 9c",
  },
  {
    title: "One trace",
    body: "Everything every harness does, in one event schema. What a trace cannot rebuild is a bug.",
    stage: "shipping",
  },
  {
    title: "One verifier",
    body: "Acceptance criteria checked by Eva rather than claimed by the agent that did the work.",
    stage: "stage 5",
  },
  {
    title: "One bill",
    body: "Cost attributed per task, per merged change, and per harness.",
    stage: "stage 11",
  },
]

export function Where() {
  return (
    <Section label="Where it goes" beat="section-y-lg">
      <h2 className="d-1 reveal max-w-measure mb-10">
        Four <span className="d-accent">ones</span>, and the stage each lands in.
      </h2>
      <div className="border-rule reveal-group border-t">
        {ones.map((row, index) => (
          <div
            key={row.title}
            className="border-rule reveal flex flex-col gap-2 border-b py-6 sm:flex-row sm:items-baseline sm:gap-8"
            style={step(index)}
          >
            <h3 className="shrink-0 font-semibold tracking-tight sm:min-w-40">{row.title}</h3>
            <p className="text-muted flex-1 text-sm">{row.body}</p>
            <span className="stage-tag" data-shipping={row.stage === "shipping"}>
              {row.stage}
            </span>
          </div>
        ))}
      </div>
      <div className="text-muted reveal mt-6 flex flex-wrap gap-x-6 text-xs">
        <a className="link-rule hover:text-ink inline-block py-1" href={doc("software-factory")}>
          What an AI-native software factory is →
        </a>
        <a className="link-rule hover:text-ink inline-block py-1" href={doc("about/roadmap")}>
          The stages, and the exit test each one can fail →
        </a>
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
              className="text-muted hover:text-ink block size-7 bg-current transition-colors duration-[var(--dur-instant)] ease-[var(--ease-fluid)]"
              style={mark(file)}
            />
          </li>
        ))}
      </ul>
      <p className="text-muted reveal max-w-measure mt-6 text-sm">
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
        <h2 className="d-2 reveal">
          Your key never reaches a settings file, a log, or the session record.
        </h2>
        <div className="reveal space-y-4">
          <p className="text-muted max-w-measure text-sm">
            Eva reads a repository&rsquo;s configuration only after you grant it. Everything runs on
            your machine.
          </p>
          <p className="text-muted max-w-measure text-sm">
            Eva is MIT licensed and the whole tree is public. {entity.company.name} is the company
            behind it, and its first product is Eva as a managed service — the same tree, operated
            for you. Self-hosting is not a downgrade path.
          </p>
        </div>
      </div>
    </Section>
  )
}

export function Faq() {
  return (
    <Section label="Questions">
      <div className="border-rule reveal-group border-t">
        {faq.map((entry, index) => (
          <details
            key={entry.question}
            className="border-rule reveal group border-b py-5"
            style={step(index)}
          >
            {/*
              `list-none` removes the native marker, so a chevron is supplied
              in its place. Open and closed must differ by more than colour.
            */}
            <summary className="hover:text-accent flex cursor-pointer list-none items-center gap-3 font-medium tracking-tight transition-colors duration-[var(--dur-instant)] ease-[var(--ease-fluid)]">
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
            <p className="text-muted max-w-measure mt-3 ml-6 text-sm">{entry.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}

export function Close() {
  return (
    <Section tone="grid" beat="section-y-lg">
      <h2 className="d-1 reveal">Run it now.</h2>
      <div className="reveal mt-8">
        <Install version={siteData.version} />
      </div>
    </Section>
  )
}

export function Footer() {
  return (
    <footer className="border-rule border-t">
      <div className="text-muted max-w-page mx-auto flex flex-wrap items-center gap-x-6 px-6 py-10 text-xs">
        <a className="link-rule hover:text-ink inline-block py-1" href={doc("")}>
          Docs
        </a>
        <a className="link-rule hover:text-ink inline-block py-1" href={doc("about/roadmap")}>
          Roadmap
        </a>
        <a className="link-rule hover:text-ink inline-block py-1" href="/changelog">
          Changelog
        </a>
        <a className="link-rule hover:text-ink inline-block py-1" href={external.repo}>
          GitHub
        </a>
        <a className="link-rule hover:text-ink inline-block py-1" href="/privacy">
          Privacy
        </a>
        <a className="link-rule hover:text-ink inline-block py-1" href={external.license}>
          MIT license
        </a>
        <span className="ml-auto">
          © {new Date().getFullYear()} {entity.company.name}
        </span>
      </div>
    </footer>
  )
}
