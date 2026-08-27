---
version: alpha
name: Eva
description: >-
  Eva is an AI-native software factory whose product is a terminal program.
  Every surface it owns — the terminal, the product app, the marketing site,
  the documentation — is the same instrument read at a different distance, so
  they share one design system and differ only by an overlay.
colors:
  primary: "#7aa2f7"
  on-primary: "#0a0a0a"
  mark: "#7aa2f7"

  canvas: "#0a0a0a"
  canvas-sunken: "#060606"
  canvas-raised: "#161616"
  canvas-overlay: "#1c1c1c"
  canvas-panel: "#101010"
  hairline: "#232323"
  hairline-strong: "#2e2e2e"
  edge: "#747474"
  grid: "#1b1b1b"

  ink: "#f2f2f2"
  body: "#b4b4b4"
  mute: "#8a8a8a"
  heading: "#ffffff"

  warning: "#e0af68"
  success: "#4cc38a"
  danger: "#f2555a"

  terminal-fg: "#e6e6e6"
  terminal-muted: "#8a8a94"
  terminal-accent: "#7aa2f7"
  terminal-warning: "#e0af68"
typography:
  display-xl:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 4.5rem
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: -0.025em
  display-lg:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 3.75rem
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: -0.022em
  display-md:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 3rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.02em
  display-sm:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1.875rem
    fontWeight: 500
    lineHeight: 2.25rem
    letterSpacing: -0.012em
  title:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1.25rem
    fontWeight: 500
    lineHeight: 1.75rem
    letterSpacing: -0.006em
  body-lg:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.75rem
  body-md:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  body-md-strong:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.5rem
  body-sm:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  body-sm-strong:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  button-md:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  button-sm:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1rem
  caption:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
  label:
    fontFamily: Geist Mono, ui-monospace, monospace
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
    letterSpacing: 0.08em
  code:
    fontFamily: Geist Mono, ui-monospace, monospace
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
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
  grid-cell: 1.5rem
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  button-accent:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  button-secondary:
    backgroundColor: "{colors.canvas-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  button-quiet:
    textColor: "{colors.body}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  button-icon:
    textColor: "{colors.mute}"
    rounded: "{rounded.sm}"
    size: "{spacing.xl}"
  card:
    backgroundColor: "{colors.canvas-raised}"
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
    backgroundColor: "{colors.canvas-raised}"
    textColor: "{colors.warning}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  stage-tag:
    textColor: "{colors.mute}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "{spacing.xs} {spacing.sm}"
  stage-tag-shipping:
    textColor: "{colors.primary}"
  text-input:
    backgroundColor: "{colors.canvas-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
  nav-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm-strong}"
    padding: "{spacing.md} {spacing.xl}"
  nav-link:
    textColor: "{colors.body}"
    typography: "{typography.body-sm-strong}"
    rounded: "{rounded.sm}"
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
    typography: "{typography.label}"
  eyebrow-index:
    textColor: "{colors.mark}"
    typography: "{typography.label}"
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
end, from a spec a machine can check to evidence that it was done. The design
brief is still the line the product prints in its own banner: **evidence, not
claims**. What changes in this revision is the hand the evidence is written
in.

The previous system spoke in a display serif on a pure black poster. This one
speaks the way the product does: a sans for prose and a mono for anything the
machine said. It is the language of the instruments Eva sits beside — Axiom's
near-black readout with one signal colour, Warp's work-order rows set in
lowercase mono, Factory's industrial surfaces and numbered mono labels — and
it drops nothing Eva already owned: the flat ground, the hairline rules, the
measurement grid, the periwinkle the terminal paints with.

**Key characteristics:**

- One chromatic signal, `{colors.primary}` `#7aa2f7`, the accent the terminal
  already paints with. The genre reached for orange (Axiom, Factory); keeping
  the terminal's own periwinkle is both distinct in that landscape and honest
  to the product, because the hero image on every surface is the real program.
- A near-black canvas, `{colors.canvas}` `#0a0a0a`, instead of pure `#000000`.
  Pure black haloes on OLED and crushes the tonal steps above it; `#0a0a0a`
  leaves room for a sunken step below the page.
- Two faces: **Geist** for display, body and controls; **Geist Mono** for
  everything that is evidence — code, transcripts, labels, timestamps,
  metadata. The mono is a voice, not a decoration: if the machine produced
  the text, the mono sets it.
- Depth is a hairline and a tonal step. No shadow anywhere, no gradient
  anywhere — the previous system's one hero-text gradient is gone.
- A 24 px **dot grid** is the only texture, replacing the 48 px line grid.
  Dots read as graph paper — a field you measure on — where lines read as a
  cage.
- Terminal imagery is the one decorative system, and it is the real program.

## One system, four surfaces

Eva has four interfaces: the **cli** (the product, a terminal program), the
**web** app (the product's browser surface), **www** (marketing), and
**docs** (documentation). The question this document settles: they get **one
design system, not four** — a single token source in `packages/ui`, and a
thin overlay per surface.

The reasoning is short. The surfaces differ by _distance_, not by _identity_:
marketing is the instrument seen across the room, docs is the instrument's
manual, web is the instrument's panel, cli is the instrument itself. Four
systems would mean four palettes to keep in contrast-checked agreement and
four places for the accent to drift. One system means a token changes once
and every surface follows.

What each surface may vary is written into its overlay, and only these axes:

| Axis          | www            | docs                | web                 | cli             |
| ------------- | -------------- | ------------------- | ------------------- | --------------- |
| Scheme        | dark only      | light + dark        | dark first          | terminal themes |
| Density       | expressive     | reading             | dense               | character grid  |
| Display scale | full, to 72 px | capped at 30 px     | capped at 20 px     | none            |
| Motion        | full contract  | instant + fast only | instant + fast only | none            |
| Texture       | dot grid       | none                | none                | none            |

An overlay may **remap semantic tokens** (a different default scheme, a
tighter control height, a narrower measure). It may never introduce a new
colour, face, radius or duration. A raw value in an app stylesheet is a
defect wherever it appears.

## CSS architecture

Everything below is the target state. Nothing here is built yet; the plan to
get there is in [Implementation plan](#implementation-plan).

### The layers

Four layers, each of which may only reference the layer beneath it:

1. **Primitives** — the raw ladders: the neutral scale, the accent scale, the
   type scale, spacing, radius, durations and easings. Scheme-free. No
   component and no app reads a primitive directly.
2. **Semantic roles** — the names this document uses: `canvas`, `ink`,
   `hairline`, `edge`, `primary`. Defined twice, once per scheme, as CSS
   custom properties. This is the only layer where light and dark exist.
3. **Components** — buttons, cards, inputs, the shadcn variable mapping. Set
   entirely in semantic roles, so a component is scheme-blind and
   surface-blind by construction.
4. **Surface overlays** — one small file per app that remaps semantic tokens
   for that surface's distance. Ten to thirty lines each, no literals.

### The files

```
packages/ui/src/styles/
  tokens.css        @font-face (Geist, Geist Mono, self-hosted)
                    + primitives + semantic roles
                    (:root is dark; [data-theme="light"] is light)
  typography.css    display, body, label and code classes
  surfaces.css      dot grid, panel, cards, buttons, rules
  motion.css        the reveal system and the motion contract
  shadcn.css        semantic roles mapped onto shadcn/Base UI variables
  globals.css       entry point: base layer, resets, imports

apps/www/src/styles/app.css    imports ui, then the www overlay
apps/docs/src/styles/app.css   imports ui, then the docs overlay
apps/web/src/styles.css        imports ui, then the web overlay
packages/tui                   theme.ts mirrors the terminal contract
```

So: **separate themes, consolidated files** — the common CSS is the whole of
`packages/ui/src/styles`, the "separate theme" per interface is one overlay
file that remaps roles and nothing else. The scheme dimension lives in
`tokens.css` alone; an overlay picks a default scheme, it never defines one.

The terminal takes the same system through a different pipe: the renderer
contract names four colours (see [Terminal](#terminal)), and
`packages/tui`'s default theme carries the same hex values the frontmatter
does. A conformance test pins the two sources to each other, since the
terminal reads TypeScript, not CSS.

### Rules that hold the layers

- An app stylesheet contains no colour literal, no font-family, no
  `@font-face`. A test greps the three app entry files for hex, `rgb(`,
  `oklch(` and `@font-face` and fails on any hit.
- A component style reads only semantic roles. Primitives are private to
  `tokens.css`.
- The existing tests in `apps/docs/src/lib/tokens.test.ts` keep holding the
  font line: exactly two families, both self-hosted, no third-party origin.
- The theme cookie (`packages/ui/src/theme.ts`) remains the cross-origin
  source of truth for scheme preference between docs and web. www no longer
  participates: it is dark only.

## Colors

### How the palette is built

Underneath the semantic names sits a 12-step neutral ladder in the Radix
manner — steps 1–2 are grounds, 3–5 are raised fills, 6–8 are borders, 9–10
are solid fills, 11–12 are text. The ladder itself is a primitive; nothing
outside `tokens.css` ever names a step. The tokens below are the semantic
layer, and they are the only names this document, the components and the
apps use. The dark scheme is normative in the frontmatter; the light scheme
is the table at the end of this section.

### Brand & Accent

- **Periwinkle** (`{colors.primary}` — `#7aa2f7`): the single signal, the
  exact accent the terminal paints with. It carries links, the shipping stage
  tag, the eyebrow index and the focus ring. On the canvas it measures
  **7.86:1**.
- **On Primary** (`{colors.on-primary}` — `#0a0a0a`): the ink on a periwinkle
  fill, at the same 7.86:1.
- **Mark** (`{colors.mark}` — `#7aa2f7`): the graphics-only accent for painted
  shapes. A separate token because the light scheme darkens
  `{colors.primary}` for legibility but leaves the mark alone. Text set in
  the mark on a light ground measures 2.41:1 and is a defect.

### Surface

- **Canvas** (`{colors.canvas}` — `#0a0a0a`): the page.
- **Canvas Sunken** (`{colors.canvas-sunken}` — `#060606`): the step below
  the page — a well an embedded capture sits in, the track behind a filled
  control.
- **Canvas Raised** (`{colors.canvas-raised}` — `#161616`): cards, tiles,
  secondary buttons, inputs.
- **Canvas Overlay** (`{colors.canvas-overlay}` — `#1c1c1c`): popovers,
  menus, tooltips — the one step that floats, and it still casts no shadow.
- **Canvas Panel** (`{colors.canvas-panel}` — `#101010`): code blocks and the
  terminal panel. Dark in _both_ schemes, because the program it stands for
  is; its ink is pinned, not flipped.
- **Hairline** (`{colors.hairline}` — `#232323`): the 1 px divider.
- **Hairline Strong** (`{colors.hairline-strong}` — `#2e2e2e`): the same edge
  under hover or focus.
- **Edge** (`{colors.edge}` — `#747474`): the boundary that identifies a
  control, at **4.24:1** on the canvas. A hairline may bound a card; only
  edge may be the sole thing that says "this is an input".
- **Grid** (`{colors.grid}` — `#1b1b1b`): the dot-grid ink.

### Text

- **Ink** (`{colors.ink}` — `#f2f2f2`): default text, at **17.68:1**.
- **Body** (`{colors.body}` — `#b4b4b4`): secondary copy and lede, at
  **9.55:1**.
- **Mute** (`{colors.mute}` — `#8a8a8a`): captions, timestamps, labels and
  fine print, at **5.73:1** on the canvas and **5.24:1** on a raised fill.
  This is the floor; nothing quieter may be added.
- **Heading** (`{colors.heading}` — `#ffffff`): the hero headline, flat. The
  previous system's heading gradient is retired; there is now no gradient
  anywhere.

### Semantic status

- **Warning** (`{colors.warning}` — `#e0af68`): the amber the terminal uses
  for tool output — **9.90:1** on the canvas.
- **Success** (`{colors.success}` — `#4cc38a`): a passing check, a clean
  diff — **8.94:1**. New in this revision; the web app reports runs and
  cannot say "passed" in the accent without spending it.
- **Danger** (`{colors.danger}` — `#f2555a`): a failing check, a destructive
  action — **5.87:1**.

Status colour never carries meaning alone; the text names the state.

### The light scheme

The light scheme exists for docs and web only (www is dark only). The
frontmatter format carries no scheme dimension, so these values are normative
here:

| Role            | Dark      | Light     | Light contrast (on its ground) |
| --------------- | --------- | --------- | ------------------------------ |
| canvas          | `#0a0a0a` | `#fcfcfc` | —                              |
| canvas-sunken   | `#060606` | `#f5f5f5` | —                              |
| canvas-raised   | `#161616` | `#ffffff` | —                              |
| canvas-overlay  | `#1c1c1c` | `#ffffff` | —                              |
| canvas-panel    | `#101010` | `#101010` | pinned dark in both schemes    |
| hairline        | `#232323` | `#e5e5e5` | —                              |
| hairline-strong | `#2e2e2e` | `#d9d9d9` | —                              |
| edge            | `#747474` | `#8d8d8d` | 3.24:1                         |
| grid            | `#1b1b1b` | `#e8e8e8` | —                              |
| ink             | `#f2f2f2` | `#171717` | 17.47:1                        |
| body            | `#b4b4b4` | `#4d4d4d` | 8.24:1                         |
| mute            | `#8a8a8a` | `#6e6e6e` | 4.97:1                         |
| heading         | `#ffffff` | `#171717` | 17.47:1                        |
| primary         | `#7aa2f7` | `#3d63dd` | 5.08:1                         |
| on-primary      | `#0a0a0a` | `#fcfcfc` | 5.08:1                         |
| mark            | `#7aa2f7` | `#7aa2f7` | graphics only, never text      |
| warning         | `#e0af68` | `#ad5700` | 4.94:1                         |
| success         | `#4cc38a` | `#18794e` | 5.27:1                         |
| danger          | `#f2555a` | `#ce2c31` | 5.08:1                         |

The one standing trap carries over: `{colors.canvas-panel}` stays dark on a
light page, so the panel's ink is pinned (`terminal-*` tokens), and the
scheme-aware accent is never set on the panel — in light it would land at
3.11:1 and fail.

## Typography

### Font Family

Two faces, both self-hosted in `packages/ui`, both under the SIL Open Font
License. A test fails the build if a third is declared or if any face loads
from a third-party origin.

1. **Geist** for display, body, controls and navigation. Variable, 400 and
   500 are the working weights. Display sits at 500 — the weight the whole
   genre reads at — never bolder.
2. **Geist Mono** for code, transcripts, labels, eyebrows, timestamps,
   stage tags and tabular data, with `tnum` and a slashed zero.

Instrument Serif and Space Grotesk are retired. The rule that replaces them
is worth the trade: **if a machine produced the text, it is set in the mono;
if a person is being spoken to, it is set in the sans.** That one rule styles
the transcript, the metadata row, the eyebrow and the code block without a
per-case decision.

### Hierarchy

| Token                         | Size | Weight | Line height | Tracking | Face       | Use                                       |
| ----------------------------- | ---- | ------ | ----------- | -------- | ---------- | ----------------------------------------- |
| `{typography.display-xl}`     | 72px | 500    | 1.05        | -0.025em | Geist      | Hero headline (www only).                 |
| `{typography.display-lg}`     | 60px | 500    | 1.05        | -0.022em | Geist      | Section headline (www).                   |
| `{typography.display-md}`     | 48px | 500    | 1.1         | -0.02em  | Geist      | Tagline reveal, sub-section.              |
| `{typography.display-sm}`     | 30px | 500    | 36px        | -0.012em | Geist      | Card heading, docs h1.                    |
| `{typography.title}`          | 20px | 500    | 28px        | -0.006em | Geist      | Panel title, web app h1.                  |
| `{typography.body-lg}`        | 18px | 400    | 28px        | 0        | Geist      | Lede paragraph.                           |
| `{typography.body-md}`        | 16px | 400    | 24px        | 0        | Geist      | Default body.                             |
| `{typography.body-md-strong}` | 16px | 500    | 24px        | 0        | Geist      | Bold inline body.                         |
| `{typography.body-sm}`        | 14px | 400    | 20px        | 0        | Geist      | Secondary body, footer.                   |
| `{typography.body-sm-strong}` | 14px | 500    | 20px        | 0        | Geist      | Navigation links.                         |
| `{typography.button-md}`      | 14px | 500    | 20px        | 0        | Geist      | Button label.                             |
| `{typography.button-sm}`      | 12px | 500    | 16px        | 0        | Geist      | Compact chrome (web app).                 |
| `{typography.caption}`        | 12px | 400    | 16px        | 0        | Geist      | Captions, fine print.                     |
| `{typography.label}`          | 12px | 400    | 16px        | 0.08em   | Geist Mono | Eyebrow, stage tag, metadata — uppercase. |
| `{typography.code}`           | 14px | 400    | 20px        | 0        | Geist Mono | Code, transcript, tables.                 |

Buttons drop from the old 16 px/600 to 14 px/500: at instrument density a
bold 16 px label is a poster, and every reference in the genre sits at
13–14 px medium.

### Principles

- **Display at weight 500, never bolder.** Hierarchy comes from size, leading
  and tracking, not weight.
- **Negative tracking is part of the voice**, from -0.025em at 72 px easing
  off through the steps. The mono is never tracked negative; `{typography.label}`
  tracks _open_ at 0.08em, uppercase.
- **Every size lands on a Tailwind scale step and takes that step's line
  height.** No fluid clamp, no arbitrary value. A hero reads
  `text-4xl md:text-6xl lg:text-7xl`.
- **Never italic, anywhere.** Emphasis is colour, size or weight.
- **No hyphen inside a sentence, heading or label**, and no word left alone
  on the last line: headings set `text-wrap: balance`, body sets `pretty`.
- Headings are sentence case. Labels are uppercase mono, and that is the only
  uppercase in the system.

## Layout

### Spacing System

- **Base unit**: 4 px, with a 2 px half-step for micro-adjustments.
- **Tokens**: `{spacing.xxs}` 2 px · `{spacing.xs}` 4 px · `{spacing.sm}` 8 px ·
  `{spacing.md}` 12 px · `{spacing.lg}` 16 px · `{spacing.xl}` 24 px ·
  `{spacing.2xl}` 32 px · `{spacing.3xl}` 40 px · `{spacing.4xl}` 48 px ·
  `{spacing.5xl}` 64 px · `{spacing.6xl}` 80 px · `{spacing.7xl}` 96 px.
- **Buttons**: 8 px vertical, 12 px horizontal.
- **Card interior**: `{spacing.xl}` 24 px on www and docs; `{spacing.lg}`
  16 px in the web app, which is the density overlay at work.
- **Band padding**: `{spacing.7xl}` 96 px for the hero, `{spacing.5xl}` 64 px
  for a standard band, `{spacing.4xl}` 48 px for a run of short blocks.

Nothing between the steps, and nothing outside them. A one-off such as
`margin-top: 13px` is a defect even when it looks right.

### Grid & Container

- Content centres at `{spacing.container}` 1200 px with a `{spacing.gutter}`
  24 px gutter.
- Prose and hero headings cap at `{spacing.measure}` 680 px. Hero line breaks
  are placed by hand, where the thought breaks.
- The dot grid draws at a `{spacing.grid-cell}` 24 px pitch: a 1 px dot of
  `{colors.grid}` at each intersection, masked so the field fades out rather
  than stopping at an edge. www only.
- Documentation uses a three-region shell: top bar, page-tree sidebar, and an
  on-this-page column.
- The web app uses a two-region shell: a rail of sessions, and the transcript
  panel it drives.

### Responsive Strategy

#### Breakpoints

| Name    | Width      | Key changes                                            |
| ------- | ---------- | ------------------------------------------------------ |
| Mobile  | < 768px    | Grids collapse to 1-up; navigation becomes an overlay. |
| Tablet  | 768–1023px | 2-up grids; sidebar still a drawer.                    |
| Desktop | ≥ 1024px   | Full band layout; documentation sidebar becomes fixed. |

#### Touch Targets

Buttons render about 36 px tall (8 px padding either side of a 20 px line
box). Every control must clear 24 × 24 CSS px, and should reach 44 × 44 where
the layout allows. No affordance may depend on hover; touch has none.

#### Collapsing Strategy

- Navigation: a docked hairline bar at desktop; a full-screen overlay with
  staggered links at mobile, never a dropdown.
- Card grids: 1-up below 768 px, and the hover border-step is dropped.
- Documentation sidebar: a focus-trapping drawer below 1024 px that closes on
  `Escape` and restores focus to its toggle.
- A button row of more than two stacks full width below 768 px.

#### Image Behavior

- **Terminal captures**: the real program on `{colors.canvas-panel}`, inside
  `{rounded.lg}` chrome, sitting in a `{colors.canvas-sunken}` well. The
  capture is the artwork; every reference in the genre leads with the real
  product and so does Eva.
- **Diagrams**: monochrome SVG that inherits the surrounding text colour, so
  both schemes work without a second asset.
- **Any raster**: `max-width: 100%`, with an intrinsic aspect ratio set so
  the layout never shifts on load.

## Elevation & Depth

| Level              | Treatment                                                           | Use                                 |
| ------------------ | ------------------------------------------------------------------- | ----------------------------------- |
| Level -1 — Sunken  | `{colors.canvas-sunken}` fill.                                      | Capture wells, control tracks.      |
| Level 0 — Flat     | No border, no shadow.                                               | Bands, the page itself.             |
| Level 1 — Hairline | 1 px `{colors.hairline}` on `{colors.canvas-raised}`.               | Cards, tiles, secondary buttons.    |
| Level 2 — Panel    | `{colors.canvas-panel}` fill against the canvas, plus the hairline. | Code blocks and the terminal panel. |
| Level 3 — Overlay  | `{colors.canvas-overlay}` fill, plus `{colors.hairline-strong}`.    | Popovers, menus, tooltips.          |
| Focus              | 2 px `{colors.primary}` outline, 2 px offset.                       | Every focusable element.            |

The tonal steps are hints, not boundaries; a raised element carries its
hairline as well. Shadows are not used anywhere, overlay included — an
overlay is nearer because it is lighter and more strongly edged, not because
it casts.

## Shapes

### Border Radius Scale

Values are Tailwind's, but the token names are ours, so the two do **not**
line up by name. Read the last column before writing a utility class.

| Token            | Value  | Tailwind utility | Use                                    |
| ---------------- | ------ | ---------------- | -------------------------------------- |
| `{rounded.none}` | 0px    | `rounded-none`   | Rules, dividers, the grid, full bands. |
| `{rounded.xxs}`  | 2px    | `rounded-xs`     | The floor for a nested result.         |
| `{rounded.xs}`   | 4px    | `rounded-sm`     | Badge, inline code.                    |
| `{rounded.sm}`   | 6px    | `rounded-md`     | Buttons, inputs, small controls.       |
| `{rounded.md}`   | 8px    | `rounded-lg`     | Popovers, callouts.                    |
| `{rounded.lg}`   | 12px   | `rounded-xl`     | Cards, code blocks, the panel.         |
| `{rounded.xl}`   | 16px   | `rounded-2xl`    | A full-bleed feature panel.            |
| `{rounded.pill}` | 9999px | `rounded-full`   | Stage tags.                            |

Buttons tighten from 8 px to 6 px — a control is sharper than a container,
and the genre sits between Warp's hard 0 and Axiom's 7.6. The pill now
belongs to the stage tag alone; the navigation island that used to wear it is
retired for a docked bar.

**Nested radius.** When a shape sits inside another and the gap is under
32 px, the inner radius is the outer radius minus the gap, applied only when
the result is above 2 px. A card at `{rounded.lg}` with 8 px of padding gives
an inner element 4 px, which is `{rounded.xs}`.

### Image Geometry

- Terminal captures sit inside `{rounded.lg}` chrome.
- The eyebrow's index is a two-digit mono figure, not a painted shape; the
  8 px square mark is retired with the island.
- Icons come from Phosphor, Solar or Iconamoon, at one stroke weight, and
  never from Lucide, Feather or a Material set.

## Motion

The motion contract carries over from the previous system unchanged — it was
already the instrument's: motion confirms a state change, never announces
one, and never runs on a browser default curve.

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
`packages/ui/src/styles/motion.css`, and a test fails the build on a literal
duration or easing.

The entrance quiets down: **24 px up, transparent, resolving to settled and
opaque** over `dur-reveal` — the old 64 px blurred rise was a poster's move.
Siblings stagger by `stagger`.

- Reveals are driven by `IntersectionObserver`. A scroll listener causes
  continuous reflow and is never used.
- Only `transform` and `opacity` animate.
- Entrance motion is a marketing capability. Docs and the web app use
  `dur-instant` and `dur-fast` only, because their reader is mid-task.
- The hidden start state is gated behind a `.js` class, so a page without
  JavaScript shows its content.
- Everything transform-based is removed under `prefers-reduced-motion`.

No animation library ships to the browser. The system is CSS.

## Components

### Buttons

**`button-primary`** — the inverted CTA.
Background `{colors.ink}`, text `{colors.canvas}`, label
`{typography.button-md}`, padding `{spacing.sm} {spacing.md}`, shape
`{rounded.sm}`. The loudest element on the page, so it appears once per view.

**`button-accent`** — the periwinkle CTA.
Background `{colors.primary}`, text `{colors.on-primary}`, otherwise as
above. At most one per page.

**`button-secondary`** — the outlined default.
Background `{colors.canvas-raised}`, text `{colors.ink}`, a
`{colors.hairline}` edge that moves to `{colors.hairline-strong}` on hover.

**`button-quiet`** — the unlimited one.
No fill, text `{colors.body}`. The default for chrome; at the density a
documentation page or the web app carries, a filled button is noise.

**`button-icon`** — an icon alone, at `{spacing.xl}` 24 px.
Must carry `aria-label`. A `title` is not a substitute; it never reaches
touch.

Every button lifts nothing and casts nothing. Hover is a 6% wash, active is
`scale(0.98)`, and focus is the ring.

### Cards & Containers

**`card`** — the default content card.
Background `{colors.canvas-raised}`, a 1 px `{colors.hairline}` border on all
four sides, padding `{spacing.xl}`, shape `{rounded.lg}`. Hover moves the
border to `{colors.hairline-strong}`. No shadow. A single-sided border is
never a card edge.

**`card-panel`** — the code block and terminal panel.
Background `{colors.canvas-panel}`, body in `{typography.code}`, shape
`{rounded.lg}`. Dark in both schemes, because the program it stands for is.

**`callout-warning`** — the warning notice.
Background `{colors.canvas-raised}`, a border and icon in `{colors.warning}`,
and body text in `{colors.ink}`. The colour never carries the meaning alone.
Success and danger callouts follow the same anatomy with their own status
colour.

**`stage-tag`** — the roadmap marker.
A pill outline in `{colors.mute}` at `{typography.label}` — uppercase mono,
which is what makes it read as a machine-stamped state rather than a
decoration. When the capability is shipping it takes `{colors.primary}`. The
text names the stage, so colour is never the only signal. Every unshipped
capability carries one.

### Inputs & Forms

**`text-input`** — the dark-canvas input.
Background `{colors.canvas-raised}`, text `{colors.ink}`, a 1 px
`{colors.edge}` border, body in `{typography.body-md}`, padding
`{spacing.sm} {spacing.md}`, shape `{rounded.sm}`. The border is
`{colors.edge}` and not `{colors.hairline}` because here the outline is the
only thing that says a control is present.

Errors are inline, specific, tied by `aria-describedby`, and never an alert.

### Navigation

**`nav-bar`** — a docked bar, hairline below, on `{colors.canvas}` with a
backdrop blur once content scrolls beneath it. The floating pill island is
retired: every instrument in the genre docks its chrome, and a detached pill
is a poster's gesture. The hamburger morphs into a true X by rotation; it
never swaps glyph. The mobile menu is a full-screen overlay with staggered
links.

**`nav-link`** — a link in the bar.
Text `{colors.body}` at `{typography.body-sm-strong}`. The current page
carries `aria-current="page"`.

**`footer`** — the closing band.
Background `{colors.canvas}`, text `{colors.mute}`, padding
`{spacing.3xl} {spacing.xl}`. Carries the privacy and terms links.

### Signature Components

**`hero-band`** — the opening band.
Padding `{spacing.7xl} {spacing.xl}`. Holds the eyebrow, the headline, one
subheading, one primary action and one proof signal — and below them, the
real program in a `{colors.canvas-sunken}` well. The capture is the hero
image; there is no other.

**`hero-heading`** — flat `{colors.heading}` at `{typography.display-xl}`,
capped at `{spacing.measure}`. The old text gradient is retired; the system
now contains no gradient at all. Line breaks are placed by hand.

**`tagline-reveal`** — the large-type band further down the page.
At least two lines of `{typography.display-md}`, capped at
`{spacing.measure}`. Words rest at 30% of `{colors.ink}` and reach full
colour one at a time, in reading order, as each crosses the trigger line.
Under `prefers-reduced-motion` every word renders at full colour immediately.

**`eyebrow`** and **`eyebrow-index`** — the section marker.
A two-digit mono index in `{colors.mark}` (`01`, `02`, …), then a label in
`{typography.label}` at `{colors.mute}`, uppercase. It is a label, not a
heading, and is not marked up as one.

**`grid-surface`** — the dot grid.
A 1 px dot of `{colors.grid}` at each `{spacing.grid-cell}` 24 px
intersection, masked so it fades out rather than stopping at an edge. The
only texture, and www-only.

**`rule`**, **`rule-hover`**, **`rule-control`** — the three 1 px lines.
A hairline divider, the same line under hover, and the control boundary. They
are modelled as filled 1 px elements because a border is a painted region and
this format carries fills.

## Surface briefs

What each interface does with the system. These are the normative overlay
contents; the overlay files implement exactly this and nothing more.

### www — the instrument across the room

Dark only. Full display scale to 72 px, full motion contract, the dot grid,
the tagline reveal. Every image is the real program. One accent button per
page, one primary per view. No light scheme: the site is a night-lit readout,
and dropping the second scheme deletes the entire class of light-mode
contrast defects the old document had to warn about.

### docs — the manual

Light and dark, reader's choice, defaulting to the system scheme; the cookie
in `packages/ui/src/theme.ts` keeps the choice in step with the web app.
Display capped at `{typography.display-sm}`; a docs page never shouts. Motion
`dur-instant`/`dur-fast` only. No dot grid. Prose measure 680 px. The
three-region shell, code blocks on the pinned-dark panel.

### web — the panel

Dark first, matching the terminal it fronts; light ships whenever the
semantic layer's light column is wired in, at no extra design cost. Density
overlay: card interiors at `{spacing.lg}`, controls at `{typography.button-sm}`
where rows are tight, titles at `{typography.title}`. The full status set
(success, warning, danger) lives here. Motion `dur-instant`/`dur-fast` only.
shadcn components read `shadcn.css`, which is already mapped to semantic
roles, so no component is styled twice.

### cli — the instrument

No CSS. The renderer contract names four colours and a theme fills every one
of them and no more (see [Terminal](#terminal)). The default theme's values
are the `terminal-*` tokens above, so the program and its three web surfaces
agree on sight. High-contrast and monochrome themes ship beside the default.

## Terminal

The terminal is the product, so its palette is part of this system and not a
separate one. A theme fills every colour the renderer contract names and no
more; a colour no renderer reads is not carried. The contract names four:

- `{colors.terminal-fg}` for a person's words and the agent's words alike.
- `{colors.terminal-muted}` for reasoning and anything secondary.
- `{colors.terminal-accent}` for the bar beside a person's turn.
- `{colors.terminal-warning}` for tool output.

The default theme maps onto the site accent exactly. Two further themes ship:
high contrast, and monochrome for terminals without colour. A person's turn
is marked by the accent bar beside it; the words themselves stay the reading
colour, because emphasis is position and weight, not hue.

## Do's and Don'ts

### Do

- Read a semantic token. `{colors.ink}` on `{colors.canvas}`, never a hex.
- Keep one accent per view, and at most one accent button per page.
- Set machine-produced text in Geist Mono, and prose in Geist. That one rule
  decides every ambiguous case.
- Use `{colors.mark}` for painted shapes and `{colors.primary}` for text.
- Give an input `{colors.edge}`. It is the only border that clears 3:1.
- Pin the ink on `{colors.canvas-panel}`. That field is dark in both schemes.
- Land every size on a scale step and take that step's line height.
- Keep buttons at `{rounded.sm}` 6 px and labels at 14 px/500.
- Take every duration and easing from the motion table.
- Let the page work with motion disabled and with JavaScript off.
- Put a stage tag on any capability that has not shipped.
- Self-host both faces.
- Put surface differences in the app's overlay file, and only remaps there.

### Don't

- Don't introduce a second accent colour to rank two kinds of importance.
- Don't set text in `{colors.mark}` on a light ground; it measures 2.41:1.
- Don't put the scheme-aware accent on `{colors.canvas-panel}` in light mode;
  it measures 3.11:1.
- Don't identify a control with a hairline; hairlines never reach 3:1.
- Don't set body copy in a status colour on a light ground without checking
  the light column; the light values are tuned to clear 4.5:1, the dark ones
  are not their mirrors.
- Don't exceed weight 500 anywhere, and don't set anything in italic.
- Don't uppercase anything except `{typography.label}`.
- Don't write a fluid clamp or an arbitrary pixel size.
- Don't put a gradient anywhere. The hero gradient is retired.
- Don't border one side of a card, and don't add a shadow to make depth —
  overlays included.
- Don't give a button the pill; it belongs to the stage tag alone.
- Don't attach a scroll listener for a reveal.
- Don't load a font from a third-party origin.
- Don't write a colour literal, a font-family or an `@font-face` in an app
  stylesheet.

## Implementation plan

This document is the normative source from the moment it lands; the code
below it still implements the previous system. Nothing in this plan has been
executed. Each phase is a self-contained change that leaves every suite
green, ordered so the token swap lands before anything that reads it.

### Phase 0 — decisions this document already made

Recorded so the diff review has the argument, not just the outcome:

- One design system in `packages/ui`, four thin overlays. No per-app system.
- Common CSS consolidated in `packages/ui/src/styles`; per-surface themes are
  overlay files that may only remap semantic tokens.
- Geist + Geist Mono replace Instrument Serif + Space Grotesk.
- The accent stays the terminal's periwinkle; the canvas moves from `#000000`
  to `#0a0a0a`; success and danger join the status set.
- www goes dark-only; docs keeps both schemes; web ships dark first.
- The nav island, the hero gradient, the 48 px line grid and the eyebrow
  square are retired (docked bar, flat heading, 24 px dot grid, mono index).

### Phase 1 — tokens and faces (`packages/ui`)

1. Add `geist-latin-var.woff2` and `geist-mono-latin-var.woff2` to
   `packages/ui/fonts`; delete the two retired families.
2. Rewrite `tokens.css`: the two `@font-face` blocks, the primitive ladders,
   and the semantic roles — `:root` from the frontmatter above,
   `[data-theme="light"]` from the light-scheme table.
3. Update `typography.css` to the new hierarchy (display at 500, `title`,
   `label`, mono `code`), and `surfaces.css` to the new component values
   (buttons at `{rounded.sm}`, the sunken well, the overlay step, the dot
   grid).
4. Update `motion.css` only where the entrance changed: 24 px rise, no blur.
5. Remap `shadcn.css` onto the new semantic roles, including
   success/danger → the shadcn status slots.
6. Update the pinned expectations in `apps/docs/src/lib/tokens.test.ts`:
   the families assertion becomes `["Geist", "Geist Mono"]`, the `--font-mono`
   assertion becomes Geist Mono. The origin and file-existence tests hold
   unchanged.

### Phase 2 — the overlay contract (all three web apps)

1. Reduce each app entry (`apps/www/src/styles/app.css`,
   `apps/docs/src/styles/app.css`, `apps/web/src/styles.css`) to: import the
   package, then one overlay block remapping semantic tokens per its surface
   brief.
2. Add the conformance test that greps the three app entries for hex,
   `rgb(`, `oklch(` and `@font-face`, and fails on any hit.
3. Wire `data-theme` per surface: www hard-codes dark (and stops writing the
   scheme cookie), docs and web keep the cookie contract in
   `packages/ui/src/theme.ts` unchanged.

### Phase 3 — component migration (www, then docs, then web)

1. www: docked `nav-bar` replaces the island; flat hero heading; dot grid
   replaces the line grid; eyebrow index replaces the square; hero capture
   moves into a sunken well. www is first because it exercises the expressive
   end of every token.
2. docs: shell unchanged; re-point the Fumadocs theme variables at the new
   semantic roles; verify the pinned-dark panel in the light scheme.
3. web: apply the density overlay; adopt success/danger tokens in run and
   diff states; sweep for raw values the conformance test now catches.

### Phase 4 — terminal agreement

1. Confirm `packages/tui`'s default theme equals the four `terminal-*`
   values; adjust whichever side drifted (this document is normative).
2. Add the conformance test that pins the tui default theme to the
   frontmatter's `terminal-*` tokens, so the CSS and the terminal cannot
   drift apart again.

### Phase 5 — documentation reconciliation

1. Rewrite section 2.3 of [docs/ui-guidelines.md](docs/ui-guidelines.md):
   the semantic-name → custom-property map and the measured contrast table
   for the values in this document.
2. Sweep `docs/` and `plans/` for references to the retired vocabulary
   (Instrument Serif, Space Grotesk, nav island, heading gradient, 48 px
   grid) and re-point them here.

### Verification

Every phase ends the same way: the full suite runs green repeatedly, not
once — and Phase 3 additionally gets an eyes-on pass of each surface in both
schemes it ships (www dark; docs light and dark; web dark), at mobile and
desktop widths, with reduced motion on and off.
