---
version: alpha
name: Eva
description: >-
  Eva is an AI-native software factory whose product is a terminal program, and
  whose marketing and documentation surfaces are built to look like the readout
  of an instrument rather than a poster.
colors:
  primary: "#7aa2f7"
  on-primary: "#000000"
  mark: "#7aa2f7"

  canvas: "#000000"
  canvas-soft: "#181818"
  canvas-panel: "#1F1F1F"
  hairline: "#272727"
  hairline-strong: "#313131"
  edge: "#6B6B6B"
  grid: "#181818"

  ink: "#f5f5f5"
  body: "#c4c4c4"
  mute: "#989898"

  heading: "#FFFFFF"
  heading-soft: "#9B9B9B"

  warning: "#e1ad63"

  terminal-fg: "#e6e6e6"
  terminal-muted: "#8a8a94"
  terminal-accent: "#7aa2f7"
  terminal-warning: "#e0af68"
typography:
  display-xl:
    fontFamily: Instrument Serif, Georgia, serif
    fontSize: 4.5rem
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.028em
  display-lg:
    fontFamily: Instrument Serif, Georgia, serif
    fontSize: 3.75rem
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.024em
  display-md:
    fontFamily: Instrument Serif, Georgia, serif
    fontSize: 3rem
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.02em
  display-sm:
    fontFamily: Instrument Serif, Georgia, serif
    fontSize: 1.875rem
    fontWeight: 400
    lineHeight: 2.25rem
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.75rem
  body-md:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  body-md-strong:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.5rem
  body-sm:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  body-sm-strong:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  button-md:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.5rem
  button-sm:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.25rem
  caption:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
  eyebrow:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1rem
    letterSpacing: 0.12em
  code:
    fontFamily: Space Grotesk, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
    letterSpacing: 0.005em
    fontFeature: "'tnum', 'zero'"
rounded:
  none: 0px
  xxs: 0.125rem
  xs: 0.25rem
  sm: 0.375rem
  md: 0.5rem
  lg: 0.75rem
  xl: 1rem
  pill: 9999px
spacing:
  xxs: 0.125rem
  xs: 0.25rem
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  2xl: 2rem
  3xl: 2.5rem
  4xl: 3rem
  5xl: 4rem
  6xl: 5rem
  7xl: 6rem
  gutter: 1.5rem
  container: 75rem
  measure: 42.5rem
  grid-cell: 3rem
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  button-secondary:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  button-accent:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  button-quiet:
    textColor: "{colors.body}"
    typography: "{typography.button-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  button-icon:
    textColor: "{colors.mute}"
    rounded: "{rounded.md}"
    size: "{spacing.xl}"
  card:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  card-panel:
    backgroundColor: "{colors.canvas-panel}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  callout-warning:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.warning}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  stage-tag:
    textColor: "{colors.mute}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "{spacing.xs} {spacing.sm}"
  stage-tag-shipping:
    textColor: "{colors.primary}"
  text-input:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  nav-island:
    backgroundColor: "{colors.canvas-soft}"
    rounded: "{rounded.pill}"
    padding: "{spacing.sm} {spacing.md}"
  nav-link:
    textColor: "{colors.body}"
    typography: "{typography.body-sm-strong}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs} {spacing.md}"
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.mute}"
    typography: "{typography.body-sm}"
    padding: "{spacing.3xl} {spacing.xl}"
  hero-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
    padding: "{spacing.7xl} {spacing.xl}"
  content-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-lg}"
    padding: "{spacing.5xl} {spacing.xl}"
  hero-heading:
    textColor: "{colors.heading}"
    typography: "{typography.display-xl}"
    width: "{spacing.measure}"
  hero-heading-fade:
    textColor: "{colors.heading-soft}"
    typography: "{typography.display-xl}"
  hero-subheading:
    textColor: "{colors.body}"
    typography: "{typography.body-lg}"
    width: "{spacing.measure}"
  tagline-reveal:
    textColor: "{colors.ink}"
    typography: "{typography.display-md}"
    width: "{spacing.measure}"
  eyebrow:
    textColor: "{colors.mute}"
    typography: "{typography.eyebrow}"
  eyebrow-mark:
    backgroundColor: "{colors.mark}"
    size: "{spacing.sm}"
  rule:
    backgroundColor: "{colors.hairline}"
    height: 1px
  rule-hover:
    backgroundColor: "{colors.hairline-strong}"
    height: 1px
  rule-control:
    backgroundColor: "{colors.edge}"
    height: 1px
  grid-surface:
    backgroundColor: "{colors.grid}"
    size: "{spacing.grid-cell}"
  link-inline:
    textColor: "{colors.primary}"
    height: 1px
  code-comment:
    textColor: "{colors.mute}"
    typography: "{typography.code}"
  terminal-transcript:
    backgroundColor: "{colors.canvas-panel}"
    textColor: "{colors.terminal-fg}"
    typography: "{typography.code}"
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
end, from a spec a machine can check to evidence that it was done. The product
is a terminal program first; the marketing and documentation sites are the
second surface, and their job is to report on the first.

The design brief is one line the product prints in its own banner: evidence,
not claims. So the page is built like a readout, not a poster. A single flat
black canvas runs the whole length of it, broken only by hairline rules and a
faint measurement grid. The one chromatic note is the periwinkle the terminal
already paints with, which means the site and the program agree on sight.

Type is the second voice. Display is set in Instrument Serif at a single
weight, so hierarchy has to come from size, leading and tracking rather than
from getting bolder. Everything structural is Space Grotesk, code included.
Body text is 16 px at a 1.5 ratio.

**Key characteristics:**

- One chromatic signal, `{colors.primary}` `#7aa2f7`, taken from the program's
  own default theme. A second accent would make the first mean nothing.
- A flat black canvas, `{colors.canvas}` `#000000`. No gradient, no
  atmospheric backdrop, no illustration system.
- Depth is a hairline and a tonal step. There is no shadow anywhere.
- Two faces only: Instrument Serif for display, Space Grotesk for everything
  else. Code is set in the sans with tabular figures rather than in a third
  face.
- A 48 px measurement grid is the only texture, and it is a repeating line
  pattern rather than a wash.
- Terminal imagery is the one decorative system, and it is the real program.

## Colors

### Brand & Accent

- **Periwinkle** (`{colors.primary}` — `#7aa2f7`): the single signal, and the
  exact accent the terminal paints with. It carries links, the shipping stage
  tag, and the focus ring. Measured against the canvas it reaches 8.34:1.
- **On Primary** (`{colors.on-primary}` — `#000000`): the ink on a periwinkle
  fill, at 8.34:1.
- **Mark** (`{colors.mark}` — `#7aa2f7`): the graphics-only accent, for the
  eyebrow square and other painted shapes. It is a separate token because the
  light scheme darkens `{colors.primary}` for legibility but leaves the mark
  alone. Setting text in the mark on a light ground gives 2.41:1 and is a
  defect.

### Surface

- **Canvas** (`{colors.canvas}` — `#000000`): the page. Flat, and the only
  ground.
- **Canvas Soft** (`{colors.canvas-soft}` — `#181818`): the raised fill for
  cards, the navigation island, and tiles.
- **Canvas Panel** (`{colors.canvas-panel}` — `#1F1F1F`): code blocks and the
  terminal panel. This field stays dark in the light scheme too, which is why
  its ink is pinned rather than flipped. See the note below.
- **Hairline** (`{colors.hairline}` — `#272727`): the 1 px divider.
- **Hairline Strong** (`{colors.hairline-strong}` — `#313131`): the same edge
  under hover or focus.
- **Edge** (`{colors.edge}` — `#6B6B6B`): the boundary that identifies a
  control. It reaches 3.94:1 on the canvas, where the hairlines reach only
  1.19:1 to 1.61:1. A hairline may bound a card; only `{colors.edge}` may be
  the sole thing that says "this is an input".
- **Grid** (`{colors.grid}` — `#181818`): the measurement-grid line.

### Text

- **Ink** (`{colors.ink}` — `#f5f5f5`): default text, at 19.26:1.
- **Body** (`{colors.body}` — `#c4c4c4`): secondary copy and lede, at 12.04:1.
- **Mute** (`{colors.mute}` — `#989898`): captions, timestamps, stage tags and
  fine print, at 7.28:1. This is the floor; nothing quieter may be added.

### Display Gradient

- **Heading** (`{colors.heading}` — `#FFFFFF`) to **Heading Soft**
  (`{colors.heading-soft}` — `#9B9B9B`): the two stops of the hero headline
  gradient, left to right, on the text only. It is the one gradient in the
  system. The end stop is the weakest point and measures 7.56:1.

### Semantic

- **Warning** (`{colors.warning}` — `#e1ad63`): the amber the terminal uses
  for tool output, and the only signal colour beyond the accent. In the light
  scheme its counterpart measures 3.56:1, so there it carries borders, icons
  and large text, never body copy.

### A note on the second scheme

This format has no scheme dimension, so the tokens above are the dark scheme
and the ground is dark-first. The light scheme is a translation of exactly
these roles; its values are normative in section 2.3 of
[docs/ui-guidelines.md](docs/ui-guidelines.md), beside the custom properties
that implement it.

`{colors.canvas-panel}` is the one field that is dark in _both_ schemes, so
its ink is pinned rather than flipped. A light page that reaches for the
scheme-aware accent lands at **3.11:1** on that panel and fails. Accent text
is therefore not used on the panel at all.

## Typography

### Font Family

Two faces ladder the system, and both are self-hosted in `packages/brand`. A
test fails the build if a third is declared or if any face loads from a
third-party origin.

1. **Instrument Serif** for every display role. One weight only, which is the
   whole reason the display scale changes size, leading and tracking together.
2. **Space Grotesk** for body, labels, buttons, navigation and code. Variable
   300 to 700; 400, 500 and 600 are the working weights.

There is no third face. Code is set in Space Grotesk with tabular figures and
a slashed zero, which buys back most of what a monospace was giving it.

### Hierarchy

| Token                         | Size | Weight | Line height | Tracking | Scale step  | Use                          |
| ----------------------------- | ---- | ------ | ----------- | -------- | ----------- | ---------------------------- |
| `{typography.display-xl}`     | 72px | 400    | 1           | -0.028em | `text-7xl`  | Hero headline.               |
| `{typography.display-lg}`     | 60px | 400    | 1           | -0.024em | `text-6xl`  | Section headline.            |
| `{typography.display-md}`     | 48px | 400    | 1           | -0.02em  | `text-5xl`  | Tagline reveal, sub-section. |
| `{typography.display-sm}`     | 30px | 400    | 36px        | -0.015em | `text-3xl`  | Card heading.                |
| `{typography.body-lg}`        | 18px | 400    | 28px        | 0        | `text-lg`   | Lede paragraph.              |
| `{typography.body-md}`        | 16px | 400    | 24px        | 0        | `text-base` | Default body.                |
| `{typography.body-md-strong}` | 16px | 500    | 24px        | 0        | `text-base` | Bold inline body.            |
| `{typography.body-sm}`        | 14px | 400    | 20px        | 0        | `text-sm`   | Secondary body, footer.      |
| `{typography.body-sm-strong}` | 14px | 500    | 20px        | 0        | `text-sm`   | Navigation links.            |
| `{typography.button-md}`      | 16px | 600    | 24px        | 0        | `text-base` | Main button label.           |
| `{typography.button-sm}`      | 14px | 600    | 20px        | 0        | `text-sm`   | Header button label.         |
| `{typography.caption}`        | 12px | 400    | 16px        | 0        | `text-xs`   | Captions, stage tags.        |
| `{typography.eyebrow}`        | 12px | 500    | 16px        | 0.12em   | `text-xs`   | Section marker, uppercase.   |
| `{typography.code}`           | 14px | 400    | 20px        | 0.005em  | `text-sm`   | Code and terminal body.      |

### Principles

- **Display at weight 400.** The face ships one weight, so a heavier hero is
  not available and not wanted. The page reads as quietly confident.
- **Negative tracking is part of the voice**, from -0.028em at 72 px easing
  off through the display steps.
- **Every size lands on a scale step and takes that step's line height.** No
  fluid clamp, no arbitrary value. Fluidity comes from responsive steps, so a
  hero reads `text-4xl md:text-6xl lg:text-7xl`.
- **Never italic, anywhere.** Emphasis is colour, size or weight.
- **No hyphen inside a sentence, heading or label**, and no word left alone on
  the last line: headings set `text-wrap: balance`, body sets `pretty`.
- Headings are sentence case.

## Layout

### Spacing System

- **Base unit**: 4 px, with a 2 px half-step for micro-adjustments.
- **Tokens**: `{spacing.xxs}` 2 px · `{spacing.xs}` 4 px · `{spacing.sm}` 8 px ·
  `{spacing.md}` 12 px · `{spacing.lg}` 16 px · `{spacing.xl}` 24 px ·
  `{spacing.2xl}` 32 px · `{spacing.3xl}` 40 px · `{spacing.4xl}` 48 px ·
  `{spacing.5xl}` 64 px · `{spacing.6xl}` 80 px · `{spacing.7xl}` 96 px.
- **Buttons**: 8 px vertical, 12 px horizontal. Tight.
- **Card interior**: `{spacing.xl}` 24 px.
- **Band padding**: `{spacing.7xl}` 96 px for the hero, `{spacing.5xl}` 64 px
  for a standard band, `{spacing.4xl}` 48 px for a run of short blocks.

Nothing between the steps, and nothing outside them. A one-off such as
`margin-top: 13px` is a defect even when it looks right.

### Grid & Container

- Content centres at `{spacing.container}` 1200 px with a `{spacing.gutter}`
  24 px gutter.
- Prose and hero headings cap at `{spacing.measure}` 680 px, so a line never
  outruns a comfortable measure. Hero line breaks are placed by hand, where
  the thought breaks.
- The measurement grid draws a `{spacing.grid-cell}` 48 px cell, the visible
  unit of the system.
- Documentation uses a three-region shell: top bar, page-tree sidebar, and an
  on-this-page column.

### Responsive Strategy

#### Breakpoints

| Name    | Width      | Key changes                                            |
| ------- | ---------- | ------------------------------------------------------ |
| Mobile  | < 768px    | Grids collapse to 1-up; navigation becomes an overlay. |
| Tablet  | 768–1023px | 2-up grids; sidebar still a drawer.                    |
| Desktop | ≥ 1024px   | Full band layout; documentation sidebar becomes fixed. |

#### Touch Targets

Buttons render about 40 px tall (8 px padding either side of a 24 px line
box). Every control must clear 24 × 24 CSS px, and should reach 44 × 44 where
the layout allows. No affordance may depend on hover; touch has none.

#### Collapsing Strategy

- Navigation: island with a full link row at desktop; a full-screen overlay
  with staggered links at mobile, never a dropdown.
- Card grids: 1-up below 768 px, and the hover lift is dropped.
- Documentation sidebar: a focus-trapping drawer below 1024 px that closes on
  `Escape` and restores focus to its toggle.
- A button row of more than two stacks full width below 768 px.

#### Image Behavior

- **Terminal captures**: the real program on `{colors.canvas-panel}`, inside
  `{rounded.lg}` chrome.
- **Diagrams**: monochrome SVG that inherits the surrounding text colour, so
  both schemes work without a second asset.
- **Any raster**: `max-width: 100%`, with an intrinsic aspect ratio set so the
  layout never shifts on load.

## Elevation & Depth

| Level              | Treatment                                                           | Use                                  |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------ |
| Level 0 — Flat     | No border, no shadow.                                               | Bands, the page itself.              |
| Level 1 — Hairline | 1 px `{colors.hairline}` on `{colors.canvas-soft}`.                 | Cards, tiles, the navigation island. |
| Level 2 — Panel    | `{colors.canvas-panel}` fill against the canvas, plus the hairline. | Code blocks and the terminal panel.  |
| Focus              | 2 px `{colors.primary}` outline, 2 px offset.                       | Every focusable element.             |

The tonal step from canvas to canvas-soft measures 1.18:1, so it is a hint and
not a boundary; a card carries its hairline as well. Shadows are not used
anywhere, and the grid is a repeating line pattern rather than a wash.

## Shapes

### Border Radius Scale

Values are Tailwind's, but the token names are ours, so the two do **not**
line up by name. Read the last column before writing a utility class.

| Token            | Value  | Tailwind utility | Use                                    |
| ---------------- | ------ | ---------------- | -------------------------------------- |
| `{rounded.none}` | 0px    | `rounded-none`   | Rules, dividers, the grid, full bands. |
| `{rounded.xxs}`  | 2px    | `rounded-xs`     | The floor for a nested result.         |
| `{rounded.xs}`   | 4px    | `rounded-sm`     | Badge, inline code.                    |
| `{rounded.sm}`   | 6px    | `rounded-md`     | Text input, small control.             |
| `{rounded.md}`   | 8px    | `rounded-lg`     | Buttons, popovers, callouts.           |
| `{rounded.lg}`   | 12px   | `rounded-xl`     | Cards, code blocks, the panel.         |
| `{rounded.xl}`   | 16px   | `rounded-2xl`    | A full-bleed feature panel.            |
| `{rounded.pill}` | 9999px | `rounded-full`   | The navigation island and stage tags.  |

Buttons are 8 px, not pills. A pill CTA at the density the documentation
carries would compete with the prose, so the pill is reserved for the
navigation island and the stage tag.

**Nested radius.** When a shape sits inside another and the gap is under
32 px, the inner radius is the outer radius minus the gap, applied only when
the result is above 2 px. A card at `{rounded.lg}` with 8 px of padding gives
an inner element 4 px, which is `{rounded.xs}`.

### Image Geometry

- Terminal captures sit inside `{rounded.lg}` chrome.
- The eyebrow mark is an 8 px filled square, never a circle or a dot.
- Icons come from Phosphor, Solar or Iconamoon, at one stroke weight, and
  never from Lucide, Feather or a Material set.

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

These are custom properties rather than front-matter tokens, because the
format carries no motion group and would silently drop them. They live in
`packages/brand/tokens.css`, and a test fails the build on a literal duration
or easing.

The entrance is one move: 64 px up, blurred and transparent, resolving to
settled, sharp and opaque over `dur-reveal`. Siblings stagger by `stagger`.

- Reveals are driven by `IntersectionObserver`. A scroll listener causes
  continuous reflow and is never used.
- Only `transform` and `opacity` animate.
- Entrance motion is a marketing capability. Documentation uses `dur-instant`
  and `dur-fast` only, because a reader who arrived from a search result is
  mid-task.
- The hidden start state is gated behind a `.js` class, so a page without
  JavaScript shows its content.
- Everything transform-based is removed under `prefers-reduced-motion`.

No animation library ships to the browser. The system is CSS.

## Components

### Buttons

**`button-primary`** — the inverted CTA.
Background `{colors.ink}`, text `{colors.canvas}`, label
`{typography.button-md}`, padding `{spacing.sm} {spacing.md}`, shape
`{rounded.md}`. At 19.26:1 it is the loudest element on the page, so it
appears once per view.

**`button-accent`** — the periwinkle CTA.
Background `{colors.primary}`, text `{colors.on-primary}`, otherwise as above.
At most one per page.

**`button-secondary`** — the outlined default.
Background `{colors.canvas-soft}`, text `{colors.ink}`, a `{colors.hairline}`
edge that moves to `{colors.hairline-strong}` on hover.

**`button-quiet`** — the unlimited one.
No fill, text `{colors.body}`, label `{typography.button-sm}`. This is the
default for chrome; at the density a documentation page carries, a filled
button is noise.

**`button-icon`** — an icon alone, at `{spacing.xl}` 24 px.
Must carry `aria-label`. A `title` is not a substitute; it never reaches touch.

Every button lifts nothing and casts nothing. Hover is a 6% wash, active is
`scale(0.98)`, and focus is the ring.

### Cards & Containers

**`card`** — the default content card.
Background `{colors.canvas-soft}`, a 1 px `{colors.hairline}` border on all
four sides, padding `{spacing.xl}`, shape `{rounded.lg}`. Hover moves the
border to `{colors.hairline-strong}`. No shadow. A single-sided border is
never a card edge.

**`card-panel`** — the code block and terminal panel.
Background `{colors.canvas-panel}`, body in `{typography.code}`, shape
`{rounded.lg}`. Dark in both schemes, because the program it stands for is.

**`callout-warning`** — the warning notice.
Background `{colors.canvas-soft}`, a border and icon in `{colors.warning}`,
and body text in `{colors.ink}`. The colour never carries the meaning alone.

**`stage-tag`** — the roadmap marker.
A pill outline in `{colors.mute}` at `{typography.caption}`. When the
capability is shipping it takes `{colors.primary}`. The text names the stage,
so colour is never the only signal. Every unshipped capability carries one.

### Inputs & Forms

**`text-input`** — the dark-canvas input.
Background `{colors.canvas-soft}`, text `{colors.ink}`, a 1 px `{colors.edge}`
border, body in `{typography.body-md}`, padding `{spacing.sm} {spacing.md}`,
shape `{rounded.sm}`. The border is `{colors.edge}` and not `{colors.hairline}`
because here the outline is the only thing that says a control is present.

Errors are inline, specific, tied by `aria-describedby`, and never an alert.

### Navigation

**`nav-island`** — the detached pill, not a docked bar.
Background `{colors.canvas-soft}`, shape `{rounded.pill}`, set below the top
edge. The hamburger morphs into a true X by rotation; it never swaps glyph.
The mobile menu is a full-screen overlay with staggered links.

**`nav-link`** — a link in the island.
Text `{colors.body}` at `{typography.body-sm-strong}`. The current page
carries `aria-current="page"`.

**`footer`** — the closing band.
Background `{colors.canvas}`, text `{colors.mute}`, padding
`{spacing.3xl} {spacing.xl}`. Carries the privacy and terms links.

### Signature Components

**`hero-band`** — the opening band.
Padding `{spacing.7xl} {spacing.xl}`. Holds the eyebrow, the headline, one
subheading, one primary action and one proof signal.

**`hero-heading`** — the one gradient in the system.
`{typography.display-xl}`, capped at `{spacing.measure}`, running left to
right from `{colors.heading}` to `{colors.heading-soft}` on the text. Never on
a background. Line breaks are placed by hand.

**`tagline-reveal`** — the large-type band further down the page.
At least two lines of `{typography.display-md}`, capped at
`{spacing.measure}`. Words rest at 30% of `{colors.ink}` and reach full colour
one at a time, in reading order, as each crosses the trigger line. The block
never flips at once, and under `prefers-reduced-motion` every word renders at
full colour immediately.

**`eyebrow`** and **`eyebrow-mark`** — the section marker.
An 8 px filled `{colors.mark}` square, then a caption in `{typography.eyebrow}`
at `{colors.mute}`. It is a label, not a heading, and is not marked up as one.

**`grid-surface`** — the measurement grid.
A repeating `{spacing.grid-cell}` 48 px line pattern in `{colors.grid}`,
masked so it fades out rather than stopping at an edge. The only texture.

**`rule`**, **`rule-hover`**, **`rule-control`** — the three 1 px lines.
A hairline divider, the same line under hover, and the control boundary. They
are modelled as filled 1 px elements because a border is a painted region and
this format carries fills.

## Terminal

The terminal is the product, so its palette is part of this system and not a
separate one. A theme fills every colour the renderer contract names and no
more; a colour no renderer reads is not carried. The contract names four:

- `{colors.terminal-fg}` for a person's words and the agent's words alike.
- `{colors.terminal-muted}` for reasoning and anything secondary.
- `{colors.terminal-accent}` for the bar beside a person's turn.
- `{colors.terminal-warning}` for tool output.

The default theme maps onto the site accent exactly. Two further themes ship:
high contrast, and monochrome for terminals without colour. A person's turn is
marked by the accent bar beside it; the words themselves stay the reading
colour, because emphasis is position and weight, not hue.

## Do's and Don'ts

### Do

- Read a semantic token. `{colors.ink}` on `{colors.canvas}`, never a hex.
- Keep one accent per view, and at most one accent button per page.
- Use `{colors.mark}` for painted shapes and `{colors.primary}` for text.
- Give an input `{colors.edge}`. It is the only border that reaches 3:1.
- Pin the ink on `{colors.canvas-panel}`. That field is dark in both schemes.
- Land every size on a scale step and take that step's line height.
- Keep buttons at `{rounded.md}` 8 px. Tight, almost rectangular.
- Take every duration and easing from the motion table.
- Let the page work with motion disabled and with JavaScript off.
- Put a stage tag on any capability that has not shipped.
- Self-host both faces.

### Don't

- Don't introduce a second accent colour to rank two kinds of importance.
- Don't set text in `{colors.mark}` on a light ground; it measures 2.41:1.
- Don't put the scheme-aware accent on `{colors.canvas-panel}` in light mode;
  it measures 3.11:1.
- Don't identify a control with a hairline; `{colors.hairline}` reaches 1.41:1.
- Don't put body copy in `{colors.warning}` in the light scheme; 3.56:1.
- Don't add a second weight to the display face. It has one.
- Don't set anything in italic, and don't go above weight 600.
- Don't write a fluid clamp or an arbitrary pixel size.
- Don't put a gradient in a background. The only gradient is hero heading text.
- Don't border one side of a card, and don't add a shadow to make depth.
- Don't use a generous pill for a CTA.
- Don't attach a scroll listener for a reveal.
- Don't load a font from a third-party origin.
