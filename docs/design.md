---
version: alpha
name: Eva
description: >-
  Eva is an AI-native software factory whose product is a terminal program.
  Every surface it owns — the terminal, the product app, the marketing site,
  the documentation — is one dark instrument panel: a near-black canvas, a
  sans that carries prose and a mono that carries machine output, and one
  ember signal doing all the chromatic work.
colors:
  void: "#08090a"
  carbon: "#0f1011"
  obsidian: "#161718"
  graphite: "#23252a"
  smoke: "#383b3f"
  ash: "#62666d"
  fog: "#8a8f98"
  mist: "#d0d6e0"
  bone: "#e5e5e6"
  paper: "#ffffff"

  primary: "#ee6018"
  teal: "#02b8cc"
  green: "#27a644"
  red: "#eb5757"

  terminal-fg: "#e5e5e6"
  terminal-muted: "#8a8f98"
  terminal-accent: "#ee6018"
  terminal-warning: "#02b8cc"
typography:
  display:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 3.5rem
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: -0.022em
  heading-lg:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 2.5rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.022em
  heading:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 2rem
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: -0.02em
  heading-sm:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1.5rem
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.014em
  subheading:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1.25rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: -0.012em
  body-lg:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: -0.011em
  body:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: -0.011em
  body-strong:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: -0.011em
  body-sm:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.011em
  button:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.9375rem
    fontWeight: 500
    lineHeight: 1.25rem
    letterSpacing: -0.011em
  nav:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.25rem
    letterSpacing: -0.011em
  caption:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Geist Mono, ui-monospace, monospace
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.06em
  code:
    fontFamily: Geist Mono, ui-monospace, monospace
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'tnum', 'zero'"
rounded:
  sm: 0.125rem
  md: 0.375rem
  lg: 0.75rem
  xl: 1rem
  full: 9999px
spacing:
  "4": 0.25rem
  "8": 0.5rem
  "12": 0.75rem
  "16": 1rem
  "20": 1.25rem
  "24": 1.5rem
  "32": 2rem
  "40": 2.5rem
  "48": 3rem
  "64": 4rem
  "80": 5rem
  "96": 6rem
  "128": 8rem
  container: 75rem
  measure: 42.5rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.void}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "{spacing.8} {spacing.16}"
  button-secondary:
    backgroundColor: "{colors.obsidian}"
    textColor: "{colors.bone}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "{spacing.8} {spacing.16}"
  button-ghost:
    textColor: "{colors.mist}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "{spacing.8} {spacing.16}"
  button-icon:
    textColor: "{colors.fog}"
    rounded: "{rounded.md}"
    size: "{spacing.32}"
  nav-bar:
    backgroundColor: "{colors.void}"
    textColor: "{colors.mist}"
    typography: "{typography.nav}"
    padding: "{spacing.12} {spacing.24}"
  nav-link:
    textColor: "{colors.mist}"
    typography: "{typography.nav}"
    rounded: "{rounded.md}"
    padding: "{spacing.8} {spacing.12}"
  announcement:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.mist}"
    typography: "{typography.caption}"
    padding: "{spacing.8} {spacing.16}"
  card:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.bone}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "{spacing.24}"
  card-elevated:
    backgroundColor: "{colors.obsidian}"
    textColor: "{colors.bone}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "{spacing.24}"
  card-feature:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.bone}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "{spacing.32}"
  case-mark:
    backgroundColor: "{colors.primary}"
    width: 2px
  quote-block:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.fog}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.16}"
  avatar:
    backgroundColor: "{colors.obsidian}"
    textColor: "{colors.mist}"
    rounded: "{rounded.full}"
    size: "{spacing.32}"
  text-input:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.bone}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.8} {spacing.12}"
  hero-band:
    backgroundColor: "{colors.void}"
    textColor: "{colors.bone}"
    typography: "{typography.display}"
    padding: "{spacing.96} {spacing.24}"
  content-band:
    backgroundColor: "{colors.void}"
    textColor: "{colors.bone}"
    typography: "{typography.heading-lg}"
    padding: "{spacing.80} {spacing.24}"
  footer:
    backgroundColor: "{colors.void}"
    textColor: "{colors.fog}"
    typography: "{typography.nav}"
    padding: "{spacing.64} {spacing.24}"
  hero-prompt:
    textColor: "{colors.fog}"
    typography: "{typography.label}"
  hero-heading:
    textColor: "{colors.paper}"
    typography: "{typography.display}"
    width: "{spacing.measure}"
  hero-lede:
    textColor: "{colors.mist}"
    typography: "{typography.body-lg}"
    width: "{spacing.measure}"
  section-heading:
    textColor: "{colors.bone}"
    typography: "{typography.heading-lg}"
    padding: "{spacing.40} 0"
  page-heading:
    textColor: "{colors.bone}"
    typography: "{typography.heading}"
  panel-heading:
    textColor: "{colors.bone}"
    typography: "{typography.heading-sm}"
  card-heading:
    textColor: "{colors.bone}"
    typography: "{typography.subheading}"
  body-secondary:
    textColor: "{colors.fog}"
    typography: "{typography.body}"
  body-emphasis:
    textColor: "{colors.paper}"
    typography: "{typography.body-strong}"
  body-dense:
    textColor: "{colors.mist}"
    typography: "{typography.body-sm}"
  caption-note:
    textColor: "{colors.fog}"
    typography: "{typography.caption}"
  eyebrow:
    textColor: "{colors.fog}"
    typography: "{typography.label}"
  tab-active:
    textColor: "{colors.bone}"
    typography: "{typography.nav}"
  tab-inactive:
    textColor: "{colors.ash}"
    typography: "{typography.nav}"
  stage-tag:
    textColor: "{colors.fog}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "{spacing.4} {spacing.8}"
  stage-tag-shipping:
    textColor: "{colors.primary}"
    typography: "{typography.label}"
  status-ok:
    textColor: "{colors.green}"
    typography: "{typography.label}"
  status-fail:
    textColor: "{colors.red}"
    typography: "{typography.label}"
  status-running:
    textColor: "{colors.teal}"
    typography: "{typography.label}"
  link-inline:
    textColor: "{colors.bone}"
    typography: "{typography.body}"
    height: 1px
  code-inline:
    backgroundColor: "{colors.obsidian}"
    textColor: "{colors.mist}"
    typography: "{typography.code}"
    rounded: "{rounded.sm}"
    padding: "{spacing.4}"
  code-comment:
    textColor: "{colors.fog}"
    typography: "{typography.code}"
  rule:
    backgroundColor: "{colors.graphite}"
    height: 1px
  rule-strong:
    backgroundColor: "{colors.smoke}"
    height: 1px
  rule-control:
    backgroundColor: "{colors.ash}"
    height: 1px
  log-bar:
    backgroundColor: "{colors.teal}"
    height: 6px
  terminal-transcript:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.terminal-fg}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
    padding: "{spacing.16}"
  terminal-thought:
    textColor: "{colors.terminal-muted}"
    typography: "{typography.code}"
  terminal-turn-marker:
    backgroundColor: "{colors.terminal-accent}"
    width: 2px
  terminal-tool:
    textColor: "{colors.terminal-warning}"
    typography: "{typography.code}"
---

## Overview

Eva is an open-source, AI-native software factory. It runs coding work end to
end, from a spec a machine can check to evidence that it was done. The design
brief is the line the product prints in its own banner — **evidence, not
claims** — and the surface is the instrument that prints it: a near-black
panel, quiet neutrals, and one ember signal spent only where something is
actually happening.

The system was assembled from five references — Linear, Axiom, Warp, Basedash
and Factory — and every contested value was settled by measurement rather than
by taste. Where they disagreed, the number in [Colors](#colors) decided it.

**Key characteristics:**

- **Dark only.** There is no light scheme, no theme toggle, no scheme cookie.
- **Near-black, not black.** The canvas is `{colors.void}` `#08090a`. Pure
  `#000000` reaches 21:1 against white, and that much contrast haloes on OLED
  and smears text in motion. `#08090a` gives up 1.1 points of contrast and
  buys back a surface a reader can hold for an hour.
- **Two faces, one rule.** Geist carries prose and UI; Geist Mono carries
  anything a machine produced — code, transcripts, labels, metadata. They are
  one family, so their metrics agree.
- **Ink is `{colors.bone}` `#e5e5e6`, not white.** Paper white is reserved for
  the hero and inline emphasis. Full-strength white as the default ink is the
  same halation problem as a pure black ground, from the other side.
- **One chromatic signal**, `{colors.primary}` `#ee6018`, plus three states
  that only ever report a machine outcome: `{colors.teal}`, `{colors.green}`,
  `{colors.red}`.
- **Depth is a tonal step and a hairline.** Void to carbon to obsidian,
  separated by graphite. No shadow carries elevation.
- **The product is the hero.** Terminal captures and log-bar patterns are the
  only imagery.

## Colors

Ten neutrals, one accent, three states, and the four names the terminal
contract reads. Every ratio below is measured, not estimated.

### Why these neutrals

Linear's ladder was taken over Axiom's and Factory's because it is the only
one of the five with a genuinely distinct step at every job — two grounds, two
borders and four inks — and because its neutrals carry a faint blue cast that
keeps a large dark field from reading brown. The values are unchanged from the
reference.

### Surfaces

- **Void** (`{colors.void}` — `#08090a`): the page, the nav, the footer.
- **Carbon** (`{colors.carbon}` — `#0f1011`): the raised surface — cards, the
  transcript panel, code blocks, the announcement strip.
- **Obsidian** (`{colors.obsidian}` — `#161718`): the elevated surface —
  popovers, menus, secondary buttons, inline code, avatars.

### Lines

- **Graphite** (`{colors.graphite}` — `#23252a`): the hairline, at 1.30:1 on
  void. Separation between two static surfaces, and never the thing that
  identifies a control.
- **Smoke** (`{colors.smoke}` — `#383b3f`): the same edge under hover or
  focus, at 1.77:1.
- **Ash** (`{colors.ash}` — `#62666d`): the control boundary, at **3.45:1** —
  the only line in the ladder that clears the 3:1 SC 1.4.11 asks of a non-text
  edge. As text it **fails at 3.45:1**, so ash marks an inactive tab or a
  disabled label and nothing that has to be read.

### Text

- **Bone** (`{colors.bone}` — `#e5e5e6`): the default ink, at **15.83:1** on
  void, 15.13:1 on carbon, 14.26:1 on obsidian.
- **Mist** (`{colors.mist}` — `#d0d6e0`): bright secondary — navigation links,
  dense UI rows, inline code, the hero lede — at **13.64:1**.
- **Fog** (`{colors.fog}` — `#8a8f98`): secondary prose, captions, eyebrows
  and metadata, at **6.13:1** on void and 5.52:1 on obsidian. **Fog is the
  text floor.** Nothing quieter may carry text.
- **Paper** (`{colors.paper}` — `#ffffff`): the hero headline and inline
  emphasis only, at 19.93:1. It is a highlight, not a default.

### The accent

- **Ember** (`{colors.primary}` — `#ee6018`): Factory's signal orange, taken
  over Axiom's `#da5c2c` on the measurement — **6.00:1** against void where
  Axiom's reaches 5.27:1, and the same 6.00:1 for the ink sitting on the fill.
- **The ink on an ember fill is `{colors.void}`.** Bone on ember measures
  **2.64:1** and fails outright; void measures 6.00:1. Every reference in the
  set puts a light ink on its orange, and every one of them is wrong.
- Ember fills the primary CTA, draws the 2 px editorial case mark, colours the
  shipping stage tag and the transcript's turn marker, and paints the focus
  ring. **Nothing else.** Scattered onto ordinary text, icons or borders it
  stops meaning "here".

### States

These report what a machine did, and only that. They never decorate chrome.

- **Teal** (`{colors.teal}` — `#02b8cc`): running, in progress, and the
  log-bar histogram — at **8.29:1**, the most legible data colour in the five
  references.
- **Green** (`{colors.green}` — `#27a644`): a passing check, a clean diff, at
  **6.29:1**.
- **Red** (`{colors.red}` — `#eb5757`): a failing check, a destructive action,
  at **5.73:1**.

Status colour never carries meaning alone; the text names the state and a
symbol confirms it.

### Terminal contract

The renderer contract names four colours, and a theme fills every one and no
more. They are the same values the rest of the system uses:

- `{colors.terminal-fg}` `#e5e5e6` — a person's words and the agent's words.
- `{colors.terminal-muted}` `#8a8f98` — reasoning and anything secondary.
- `{colors.terminal-accent}` `#ee6018` — the bar beside a person's turn.
- `{colors.terminal-warning}` `#02b8cc` — tool output. The contract's key is
  named `warning` for historical reasons; the colour is teal, because tool
  output is machine data rather than an alarm.

### Measured contrast

| Ink                  | on void | on carbon | on obsidian | Verdict                      |
| -------------------- | ------- | --------- | ----------- | ---------------------------- |
| `paper` `#ffffff`    | 19.93   | 19.05     | 17.95       | Emphasis only                |
| `bone` `#e5e5e6`     | 15.83   | 15.13     | 14.26       | The default ink              |
| `mist` `#d0d6e0`     | 13.64   | 13.04     | 12.29       | Bright secondary             |
| `fog` `#8a8f98`      | 6.13    | 5.86      | 5.52        | The text floor               |
| `ash` `#62666d`      | 3.45    | 3.30      | 3.11        | **Never text.** Borders only |
| `smoke` `#383b3f`    | 1.77    | 1.69      | 1.59        | Line                         |
| `graphite` `#23252a` | 1.30    | 1.24      | 1.17        | Hairline                     |
| `primary` `#ee6018`  | 6.00    | 5.73      | —           | The accent                   |
| `teal` `#02b8cc`     | 8.29    | 7.92      | —           | Running, log bars            |
| `green` `#27a644`    | 6.29    | 6.01      | —           | Passed                       |
| `red` `#eb5757`      | 5.73    | 5.47      | —           | Failed                       |
| `void` on ember      | 6.00    | —         | —           | The CTA ink                  |
| `bone` on ember      | 2.64    | —         | —           | **A defect. Never.**         |

## Typography

### Font Family

Two faces, both self-hosted in `packages/ui` as variable fonts, both under the
SIL Open Font License:

1. **Geist** for display, body, controls and navigation.
2. **Geist Mono** for code, transcripts, labels, eyebrows, timestamps and
   tabular data, with `tnum` and a slashed zero.

They are one family, so their metrics, x-height and letterforms agree — a
command set in the mono beside a sentence in the sans reads as one system
rather than two.

**The rule that decides every case: if a machine produced the text, it is set
in the mono; if a person is being spoken to, it is set in the sans.** That one
line styles the transcript, the metadata row, the eyebrow and the code block
without a per-case decision.

An earlier revision of this system set _everything_ in the mono, following
Axiom. That is the one place Axiom is measurably wrong: a monospaced face
slows continuous reading, and Eva's documentation is continuous reading. Every
other reference in the set — Linear, Warp, Factory, Basedash — pairs a sans
with a mono, and so does this one.

Weights: **400** for prose, **500** for headings, buttons and emphasis. Never
above 600, and never italic.

### Hierarchy

Tracking follows Linear's discipline: about **-0.011em** at reading sizes,
tightening to **-0.022em** at display sizes, because tracking that is right at
56 px closes the letters up at 16 px. The mono never tracks negative;
`{typography.label}` tracks _open_ at +0.06em.

| Token                      | Size | Weight | Line height | Tracking | Face       | Use                                 |
| -------------------------- | ---- | ------ | ----------- | -------- | ---------- | ----------------------------------- |
| `{typography.display}`     | 56px | 500    | 1.05        | -0.022em | Geist      | Hero headline (www).                |
| `{typography.heading-lg}`  | 40px | 500    | 1.1         | -0.022em | Geist      | Section headline.                   |
| `{typography.heading}`     | 32px | 500    | 1.15        | -0.02em  | Geist      | Docs page title.                    |
| `{typography.heading-sm}`  | 24px | 500    | 1.25        | -0.014em | Geist      | Docs h2, panel title.               |
| `{typography.subheading}`  | 20px | 500    | 1.4         | -0.012em | Geist      | Card headline.                      |
| `{typography.body-lg}`     | 18px | 400    | 1.6         | -0.011em | Geist      | Lede.                               |
| `{typography.body}`        | 16px | 400    | 1.6         | -0.011em | Geist      | Default prose.                      |
| `{typography.body-strong}` | 16px | 500    | 1.6         | -0.011em | Geist      | Inline emphasis.                    |
| `{typography.body-sm}`     | 15px | 400    | 1.5         | -0.011em | Geist      | Dense UI, web app rows.             |
| `{typography.button}`      | 15px | 500    | 20px        | -0.011em | Geist      | Every button label.                 |
| `{typography.nav}`         | 15px | 400    | 20px        | -0.011em | Geist      | Navigation, footer links.           |
| `{typography.caption}`     | 13px | 400    | 1.4         | 0        | Geist      | Captions, fine print.               |
| `{typography.label}`       | 13px | 400    | 1.4         | +0.06em  | Geist Mono | Eyebrow, tag, metadata — uppercase. |
| `{typography.code}`        | 13px | 400    | 1.6         | 0        | Geist Mono | Code, transcript, tables.           |

**Body is 16 px at a 1.6 ratio.** That is the reading size, and it is the one
value here chosen purely for long-form legibility: Axiom's 14 px and Linear's
15 px are UI sizes, and Eva's documentation is prose. Dense product surfaces
step down to `{typography.body-sm}` 15 px.

Code is 13 px at 1.6. A monospaced face renders optically larger than a sans
at the same pixel size, so code set one step below body reads level with it.

### Principles

- **Every size lands on the scale above and takes that step's line height.**
  No fluid clamp, no arbitrary value.
- Headings are sentence case. Uppercase belongs to `{typography.label}` alone.
- **Never italic, anywhere.** Emphasis is colour, size or weight.
- No hyphen inside a sentence, heading or label, and no word left alone on the
  last line: headings set `text-wrap: balance`, body sets `pretty`, long-form
  documentation sets neither.
- Arrow glyphs are text set in the face: `→` after an action label, `~/` as
  the hero prompt.

## Layout

### Spacing System

- **Base unit**: 4 px, on Linear's grid — the most flexible of the five, and
  the one Tailwind speaks natively.
- **Tokens**: `{spacing.4}` 4 · `{spacing.8}` 8 · `{spacing.12}` 12 ·
  `{spacing.16}` 16 · `{spacing.20}` 20 · `{spacing.24}` 24 · `{spacing.32}`
  32 · `{spacing.40}` 40 · `{spacing.48}` 48 · `{spacing.64}` 64 ·
  `{spacing.80}` 80 · `{spacing.96}` 96 · `{spacing.128}` 128.
- **Buttons**: 8 px vertical, 16 px horizontal — about 36 px tall.
- **Card interior**: `{spacing.24}` 24 px; a feature panel takes 32 px, a
  nested quote block 16 px.
- **Section rhythm**: `{spacing.40}` between related blocks, `{spacing.80}`
  between sections, `{spacing.96}` for the hero band.

Nothing between the steps, and nothing outside them. A one-off such as
`margin-top: 13px` is a defect even when it looks right.

### Grid & Container

- Content centres at `{spacing.container}` 1200 px with a 24 px gutter.
- Prose and hero headings cap at `{spacing.measure}` 680 px.
- The hero is a left-aligned block: the `~/` prompt in fog, a two-line
  headline, one primary action and one ghost action, the real program below.
- Documentation uses a three-region shell: top bar, page-tree sidebar, and an
  on-this-page column. The web app uses a rail of sessions beside the
  transcript panel it drives.

### Responsive Strategy

| Name    | Width      | Key changes                                            |
| ------- | ---------- | ------------------------------------------------------ |
| Mobile  | < 768px    | Grids collapse to 1-up; navigation becomes an overlay. |
| Tablet  | 768–1023px | 2-up grids; sidebar still a drawer.                    |
| Desktop | ≥ 1024px   | Full band layout; documentation sidebar becomes fixed. |

- Every control clears 24 × 24 CSS px and reaches 44 × 44 where the layout
  allows. No affordance depends on hover; touch has none.
- Terminal captures sit on `{colors.carbon}` inside `{rounded.lg}` chrome with
  a `{colors.graphite}` hairline. Any raster sets `max-width: 100%` with an
  intrinsic aspect ratio.
- No photography, no lifestyle imagery, no 3D renders. Product captures, log
  bars and grayscale marks are the whole image system.

## Elevation & Depth

| Level | Surface             | Treatment                                       | Use                                 |
| ----- | ------------------- | ----------------------------------------------- | ----------------------------------- |
| 0     | `{colors.void}`     | Flat.                                           | The page, the nav, the footer.      |
| 1     | `{colors.carbon}`   | Tonal step plus a `{colors.graphite}` hairline. | Cards, code blocks, the transcript. |
| 2     | `{colors.obsidian}` | Tonal step plus hairline.                       | Popovers, menus, secondary buttons. |
| —     | Focus               | 2 px `{colors.primary}` outline, 2 px offset.   | Every focusable element.            |

Elevation is a tonal step and a hairline. The one exception is an element that
genuinely detaches from the page — a popover or a menu over content — which
may carry `rgba(8, 9, 10, 0.6) 0 4px 32px`. A card never casts, and no shadow
is ever used to make a flat surface look raised.

## Shapes

| Token            | Value  | Use                                                |
| ---------------- | ------ | -------------------------------------------------- |
| `{rounded.sm}`   | 2px    | Inline code, badges, the floor for a nested shape. |
| `{rounded.md}`   | 6px    | Buttons, inputs, small controls, popovers.         |
| `{rounded.lg}`   | 12px   | Cards, code blocks, the transcript panel.          |
| `{rounded.xl}`   | 16px   | A full-bleed feature panel.                        |
| `{rounded.full}` | 9999px | Avatars, stage tags, icon badges.                  |

Linear's range is taken over Axiom's 2 px-everywhere: at a 36 px control a
2 px corner reads as an unfinished rectangle, and 6 px is the smallest radius
that reads as deliberate. The 2 px floor is kept for small nested shapes.

**Nested radius.** When a shape sits inside another and the gap is under
32 px, the inner radius is the outer minus the gap, applied only when the
result is above 2 px.

## Motion

Motion confirms a state change. It never announces one, and it never runs on a
browser default curve.

| Token         | Value                               | Use                                |
| ------------- | ----------------------------------- | ---------------------------------- |
| `ease-fluid`  | `cubic-bezier(0.32, 0.72, 0, 1)`    | Every transition.                  |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | A control that must feel physical. |
| `dur-instant` | 150ms                               | Hover, focus, active.              |
| `dur-fast`    | 300ms                               | Popover, dropdown, disclosure.     |
| `dur-base`    | 700ms                               | The default transition.            |
| `dur-reveal`  | 800ms                               | An element entering the viewport.  |
| `stagger`     | 50ms                                | The step between siblings.         |

These live as custom properties in `packages/ui/src/styles/tokens.css`; a test
fails the build on a literal duration or easing.

- The entrance is one move: 24 px up and transparent, resolving to settled and
  opaque over `dur-reveal`. Siblings stagger by `stagger`.
- Reveals are driven by `IntersectionObserver`; only `transform` and `opacity`
  animate; the hidden start state is gated behind a `.js` class; everything
  transform-based is removed under `prefers-reduced-motion`.
- Buttons move by colour change and the 0.98 press. No lift, no shadow.
- Entrance motion is a marketing capability. Documentation and the web app use
  `dur-instant` and `dur-fast` only.
- No animation library ships to the browser. The system is CSS.

## Components

### Buttons

**`button-primary`** — the ember CTA, the conversion anchor.
Fill `{colors.primary}`, label `{colors.void}` at `{typography.button}`,
padding `{spacing.8} {spacing.16}`, shape `{rounded.md}`. An arrow glyph (`→`)
follows the label. One per view.

**`button-secondary`** — the filled default.
`{colors.obsidian}` fill, `{colors.bone}` label, a `{colors.graphite}` edge
that moves to `{colors.smoke}` on hover.

**`button-ghost`** — the unlimited one, and the default for chrome.
No fill, label `{colors.mist}`. At the density a documentation page carries, a
filled button is noise.

**`button-icon`** — an icon alone at `{spacing.32}` 32 px, ink `{colors.fog}`.
Must carry `aria-label`; a `title` never reaches touch.

Hover is a 6% wash of the ink; active is `scale(0.98)`; focus is the ring.
Disabled is `aria-disabled`, never the attribute.

### Chrome

**`nav-bar`** — one docked full-width bar on `{colors.void}`, about 56 px
tall, links at `{typography.nav}` in `{colors.mist}`, a `{colors.graphite}`
hairline below and a backdrop blur once content scrolls beneath. No island, no
mega-menu. The hamburger morphs into a true X by rotation; the mobile menu is
a full-screen overlay with staggered links.

**`announcement`** — a full-width `{colors.carbon}` strip at
`{typography.caption}`, closing `×` at the right.

**`footer`** — the closing band on `{colors.void}`, text `{colors.fog}`,
carrying the privacy and terms links.

### Cards & Containers

**`card`** — `{colors.carbon}`, a `{colors.graphite}` hairline on all four
sides, `{rounded.lg}`, padding `{spacing.24}`. Hover moves the hairline to
`{colors.smoke}`. A single-sided border is never a card edge — with one
exception, next.

**`card-elevated`** with **`case-mark`** — the editorial card:
`{colors.obsidian}` with a 2 px solid `{colors.primary}` left border running
full height, the only colour in the card, functioning as a category mark. A
`quote-block` nests inside on `{colors.carbon}`.

**`card-feature`** — the full-bleed panel at `{rounded.xl}` and 32 px padding.

**`text-input`** — `{colors.carbon}` field, `{colors.bone}` ink, a 1 px
`{colors.ash}` border, `{rounded.md}`. The border is ash and not graphite
because here the edge is the only thing that says a control is present, and
ash is the only line that clears 3:1. Errors are inline, specific, tied by
`aria-describedby`, never an alert.

**`avatar`** — the pill: `{rounded.full}`, `{colors.obsidian}` fill,
`{colors.mist}` glyph.

### Labels & states

**`eyebrow`** and **`stage-tag`** — uppercase mono at `{typography.label}` in
`{colors.fog}`. The eyebrow is pure typography; the stage tag adds a
`{rounded.full}` outline. When the capability is shipping the tag takes
`{colors.primary}`. The text names the stage, so colour is never the only
signal. Every unshipped capability carries one.

**`status-ok`**, **`status-fail`**, **`status-running`** — a run's outcome in
`{colors.green}`, `{colors.red}` and `{colors.teal}`, always beside a symbol
and the word. There is no coloured fill; the state is the glyph and the word,
and the colour only confirms it.

**`tab-active`** and **`tab-inactive`** — `{colors.bone}` with an underline
against `{colors.ash}`. Ash is legible enough to identify a resting tab and
deliberately not legible enough to compete with the selected one.

**`link-inline`** — `{colors.bone}` with a 1 px underline drawn from the
font's own metrics, skipping descenders. Colour never distinguishes a link on
its own here, so the underline is mandatory.

### Signature

**`hero-band`** — the opening band at `{spacing.96}`: `hero-prompt` (`~/` in
mono), a two-line `hero-heading` in `{colors.paper}`, a `hero-lede` in
`{colors.mist}`, one `button-primary` and one `button-ghost`, and the real
program on `{colors.carbon}` chrome below.

**`log-bar`** — tight rows of rectangular bars in `{colors.teal}`, 4–8 px tall
with 2–4 px gaps. Event volume over time; in marketing the bar pattern itself
is the visual, no axes.

**`rule`, `rule-strong`, `rule-control`** — the three 1 px lines: the graphite
hairline, the smoke hover edge, and the ash control boundary. Modelled as
filled 1 px elements because a border is a painted region and this format
carries fills.

### Terminal

**`terminal-transcript`** — `{colors.carbon}`, body at `{typography.code}`,
`{rounded.lg}`, a `{colors.graphite}` hairline.
**`terminal-thought`** — reasoning in `{colors.terminal-muted}`.
**`terminal-turn-marker`** — the 2 px `{colors.terminal-accent}` bar beside a
person's turn; the words stay `{colors.terminal-fg}`, because emphasis is
position, not hue. **`terminal-tool`** — tool output in
`{colors.terminal-warning}`.

The default theme maps exactly onto these four values. Two further themes
ship: high contrast, and monochrome for terminals without colour.

## Do's and Don'ts

### Do

- Set prose in Geist and machine output in Geist Mono. That one rule decides
  every ambiguous case.
- Keep the canvas at `{colors.void}`; pure `#000000` haloes on OLED.
- Set default text in `{colors.bone}` and save `{colors.paper}` for the hero
  and inline emphasis.
- Keep `{colors.fog}` as the floor for anything meant to be read.
- Use `{colors.ash}` for a control's edge and an inactive label — never for
  text a reader has to take in.
- Put `{colors.void}` ink on an ember fill. Bone measures 2.64:1 there.
- Spend `{colors.primary}` on the CTA, the case mark, the shipping tag, the
  turn marker and the focus ring, and nowhere else.
- Report a machine outcome with a glyph, a word, and then the colour.
- Land every size on the type scale and take that step's line height.
- Keep body at 16 px and 1.6 leading; step to 15 px only where a surface is
  genuinely dense.
- Take every duration and easing from the motion table.
- Let the page work with motion disabled and with JavaScript off.
- Put a stage tag on any capability that has not shipped.
- Self-host both faces.

### Don't

- Don't set long-form prose in the mono. That is the one thing the terminal
  aesthetic gets wrong, and this system does not repeat it.
- Don't use pure `#000000` as a ground or pure `#ffffff` as the default ink.
- Don't set text in `{colors.ash}`, or in anything below `{colors.fog}`.
- Don't put a light ink on the ember fill.
- Don't scatter `{colors.primary}` onto ordinary text, icons or borders.
- Don't use `{colors.teal}`, `{colors.green}` or `{colors.red}` for chrome, or
  as a filled status badge.
- Don't introduce a second accent to rank two kinds of importance.
- Don't add a light-theme section, a scheme toggle, or an alternate ground.
- Don't put a shadow under a card, or use one to fake elevation anywhere
  except a genuinely detached overlay.
- Don't put a gradient anywhere.
- Don't exceed weight 600, and don't set anything in italic.
- Don't uppercase anything except `{typography.label}`.
- Don't write a fluid clamp or an arbitrary pixel size.
- Don't distinguish a link by colour alone; the underline is mandatory.
- Don't attach a scroll listener for a reveal.
- Don't load a font from a third-party origin.
