# UI guidelines — missing studio

Implementation-ready, token-driven rules for the missing studio web surfaces:
the marketing site at `missing.studio` and the documentation site at
`docs.missing.studio`.

**Design intent, in one sentence:** missing studio ships a dark instrument
panel — a near-black canvas, a sans for prose and a mono for machine output,
one ember accent — so both surfaces must spend their contrast, weight and
motion on the content and nothing else.

This file defines one system. It is not a description of what either site
renders today.

Read [design.md](design.md) first. That file is the normative token source.
This file is how those tokens become components.

"Must" marks a non-negotiable rule. "Should" marks a recommendation. Every
accessibility rule in section 4 is written as a pass/fail check.

## 0. Precedence and brand overrides

These authorities govern this system, in order:

1. **The [interface cheat sheet](https://interfaces.dev/cheat-sheet).** Adopted
   in full, and the source of the craft rules throughout this file — the ones
   about how a thing is built rather than which token it reads.
2. **This file plus design.md.** They apply the rules above to missing studio.
3. **The surface.** A site implements; it never decides.

The cheat sheet is adopted whole, with three values overridden because
design.md already sets them. Each is a number, not a principle:

| Cheat sheet                          | Ours                         | Why                                                                                                              |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Stagger staged entrances about 100ms | 50ms, `--stagger`            | design.md's motion table sets it, and the reveal runs at 800ms where the sheet assumes a shorter one.            |
| Pressed scale at 200ms `ease-out`    | 150ms `--ease-fluid`         | The scale value, 0.98, is the sheet's. The duration and the curve come from the token table, which has no 200ms. |
| Cap long-form at 60 to 75 characters | 680px, `--container-measure` | The same rule in the unit the layout uses. At the 16px body step in Geist it lands at about 75 characters.       |

The house rules say the user wins where an explicit prompt conflicts with a
rule. Both font rules conform outright:

| #   | House rule                                   | Status                                                                                                                                         |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fonts: Geist, Manrope, Geist Mono or Poppins | **Conformed.** Geist and Geist Mono, both self-hosted; `tokens.test.ts` fails the build on a third family or a CDN font.                       |
| 2   | One typeface per site                        | **Conformed in spirit.** Two members of one family, so the metrics agree. The split is functional: prose is the sans, machine output the mono. |

A future conflict must be added here with the override, the reason, and the
cost of conforming instead — or resolved in favour of the house rule.

## 1. Context and goals

| Item                 | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| Product              | Eva, an AI-native software factory for human and agent teams        |
| Publisher            | missing studio                                                      |
| Surfaces             | `missing.studio` (marketing), `docs.missing.studio` (documentation) |
| Stack                | TanStack Start, Tailwind v4, shared `@missingstudio/ui`             |
| Documentation layer  | Fumadocs 16, notebook layout                                        |
| Audience             | Developers and technical teams                                      |
| Accessibility target | WCAG 2.2 AA                                                         |
| Style                | Structured, tokenized, content-first, dark only                     |

Goals, in priority order:

1. A reader finds the answer and leaves. Time to answer beats time on page.
2. A contributor adds a page or a section without making a design decision.
3. An agent reads the page as well as a person does. Content must not depend
   on JavaScript, hover, or color alone.
4. The two sites and the terminal program agree. The same accent, the same
   faces, the same words, the same dark ground.

### 1.1 One system, two surfaces

Both surfaces consume [packages/ui](../packages/ui). Everything in
sections 2 and 4 is shared and must not be re-specified per surface. Section 3
marks each component as shared, marketing, or documentation.

The two surfaces differ in density and in intent, not in vocabulary:

|         | Marketing                      | Documentation             |
| ------- | ------------------------------ | ------------------------- |
| Job     | Convince a developer to try it | Get a developer unblocked |
| Rhythm  | Sectioned, generous            | Continuous, dense         |
| Type    | Display scale leads            | Body scale leads          |
| Motion  | Reveal on scroll               | State feedback only       |
| Density | Few controls per view          | Many controls per view    |

Where the two disagree, the system wins. A local visual exception must be
raised as a change to this file, not implemented on one surface.

### 1.2 Page composition

A typical documentation page carries 48 buttons, 31 links, 4 lists, 3 cards,
and 3 navigation regions. A marketing page carries roughly ten sections, one
hero, one command snippet, one disclosure set, and a footer.

Four rules follow, and they govern every decision below:

- Buttons must default to the ghost variant. At 48 instances a filled button
  is noise. At most one ember button may appear per page, on either surface.
- Inline links must carry no extra weight or size. At 31 instances a bold link
  turns a paragraph into a ransom note.
- Navigation must be identifiable by landmark, not by position. Three regions
  on one page means a screen reader user needs to skip two of them.
- Marketing may spend motion on entrance. Documentation must not. A reader who
  arrived from a search result is mid-task.

## 2. Design tokens and foundations

Shared by both surfaces. No surface may redefine a token in this section.

### 2.1 The token contract

- Component guidance must name a semantic token. A raw hex value, a raw
  `oklch()` value, or an off-system Tailwind color utility in component code
  is a defect.
- Semantic names are the vocabulary. The CSS custom properties in
  [packages/ui/src/styles/tokens.css](../packages/ui/src/styles/tokens.css)
  are the implementation. The mapping table in 2.3 is the contract between
  them.
- A new token must be added to `packages/ui/src/styles/tokens.css`, to
  design.md, and to this file in the same change. A token that exists in two
  of the three places is a defect.
- A surface must not define a token in its own stylesheet. If a value is
  needed twice it belongs in the brand package. If it is needed once it is not
  a token.

`bun run design:lint` checks design.md against the format's own linter and
must report **0 errors and 0 warnings**. Three rules of the format shape what
the front matter can hold, and all three are followed rather than worked
around:

| Rule of the format         | What it means here                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every colour is bound      | A colour no component references is an orphan. Ours are the ten neutrals — `void` through `paper` — plus `primary` and the three states, and each is bound to a component. |
| One scheme                 | The format has no scheme dimension, and the system is dark only, so the front matter carries the whole palette. There is no second scheme anywhere.                        |
| Eight component sub-tokens | Only `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width` exist. Borders, gradients and motion are prose, not component tokens.   |

A warning is a defect. Do not add a token the format cannot carry and then
explain the warning away; either express it within these three rules or keep
it out of the front matter and document it in prose.

### 2.2 How the five references were reconciled

The system was assembled from five captured references — Linear, Axiom, Warp,
Basedash and Factory. Where they disagreed, the measurement decided. Each
resolution below is binding.

**The ground.** Axiom, Warp and Basedash all anchor at pure `#000000`, which
reaches 21:1 against white — enough contrast to halo on OLED and smear text in
motion. **Resolution:** Linear's `#08090a`, at 19.93:1 against paper and
15.83:1 against the default ink. It gives up about a point of contrast and
buys back a surface a reader can hold for an hour.

**The default ink.** A maximum-contrast white ink is the same halation problem
from the other side. **Resolution:** bone `#e5e5e6` at 15.83:1 is the default;
paper `#ffffff` is reserved for the hero headline and inline emphasis.

**The faces.** Axiom is the only all-mono system of the five, and a monospaced
face measurably slows continuous reading — which is most of what the
documentation surface is. **Resolution:** Geist for prose and UI, Geist Mono
for machine output. They are one family, so the metrics agree, and both are on
the house-rules allowed list where Berkeley Mono and Inter are not.

**The accent.** Axiom's ember `#da5c2c` measures 5.27:1 on the ground;
Factory's signal orange `#ee6018` measures **6.00:1**. **Resolution:**
`#ee6018`, kept under the name ember.

**The CTA ink.** Every reference puts a light ink on its orange. Bone on ember
measures **2.64:1** and fails outright. **Resolution:** the ink on an ember
fill is void, at 6.00:1.

**The neutral ladder.** Linear's is the only one of the five with a distinct
step at every job — two grounds, three lines, four inks. **Resolution:** taken
whole and unchanged.

**The radius.** Axiom rounds everything to 2px, which reads as an unfinished
rectangle on a 36px control. **Resolution:** Linear's range — 2px for small
nested shapes, 6px for controls, 12px for cards.

**The type scale.** Axiom's 14px and Linear's 15px body are UI sizes.
**Resolution:** 16px at a 1.6 ratio for prose, with a 15px `body-sm` step for
genuinely dense product surfaces. Tracking follows Linear's discipline:
-0.011em at reading sizes, -0.022em at display sizes.

### 2.3 Color

The system is dark only. There is no light scheme, no theme control, no
scheme cookie, and no component may carry a `dark:` branch of its own — the
`dark` class is pinned on every root element solely so the shadcn components'
existing variants stay live.

One color has three names: the semantic name used in this file, the token
name used in design.md, and the CSS custom property that ships. They are
listed side by side because that is the only way the three stay welded
together.

| Semantic token         | design.md token | CSS property       | Value     |
| ---------------------- | --------------- | ------------------ | --------- |
| `color.surface.base`   | `void`          | `--color-void`     | `#08090a` |
| `color.surface.raised` | `carbon`        | `--color-carbon`   | `#0f1011` |
| `color.surface.high`   | `obsidian`      | `--color-obsidian` | `#161718` |
| `color.border.default` | `graphite`      | `--color-graphite` | `#23252a` |
| `color.border.strong`  | `smoke`         | `--color-smoke`    | `#383b3f` |
| `color.border.control` | `ash`           | `--color-ash`      | `#62666d` |
| `color.text.tertiary`  | `fog`           | `--color-fog`      | `#8a8f98` |
| `color.text.secondary` | `mist`          | `--color-mist`     | `#d0d6e0` |
| `color.text.primary`   | `bone`          | `--color-bone`     | `#e5e5e6` |
| `color.text.emphasis`  | `paper`         | `--color-paper`    | `#ffffff` |
| `color.accent`         | `primary`       | `--color-ember`    | `#ee6018` |
| `color.state.running`  | `teal`          | `--color-teal`     | `#02b8cc` |
| `color.state.ok`       | `green`         | `--color-green`    | `#27a644` |
| `color.state.fail`     | `red`           | `--color-red`      | `#eb5757` |

The custom properties live in Tailwind's `@theme`, so each answers as a
utility: `bg-void`, `bg-carbon`, `bg-obsidian`, `border-graphite`,
`border-smoke`, `text-fog`, `text-mist`, `text-bone`, `bg-ember`, `text-teal`.
The shadcn bridge in `shadcn.css` maps shadcn's own names
(`--color-primary`, `--color-border`, `--color-input`, `--color-muted`) onto
the same properties, so a registry component and a hand-built one read one
palette.

Measured contrast, sRGB:

| Ink                     | On void  | On carbon | On obsidian | Verdict                      |
| ----------------------- | -------- | --------- | ----------- | ---------------------------- |
| `paper`                 | 19.93    | 19.05     | 17.95       | Emphasis only                |
| `bone`                  | 15.83    | 15.13     | 14.26       | The default ink              |
| `mist`                  | 13.64    | 13.04     | 12.29       | Bright secondary             |
| `fog`                   | 6.13     | 5.86      | 5.52        | The text floor               |
| `ash`                   | **3.45** | 3.30      | 3.11        | **Never text.** Borders only |
| `smoke`                 | 1.77     | 1.69      | 1.59        | Line                         |
| `graphite`              | 1.30     | 1.24      | 1.17        | Hairline                     |
| `ember`                 | 6.00     | 5.73      | —           | The accent                   |
| `teal`                  | 8.29     | 7.92      | —           | Running, log bars            |
| `green`                 | 6.29     | 6.01      | —           | Passed                       |
| `red`                   | 5.73     | 5.47      | —           | Failed                       |
| `void` on an ember fill | 6.00     | —         | —           | The CTA ink                  |
| `bone` on an ember fill | **2.64** | —         | —           | **Fails; never do this**     |

Binding consequences:

- **Fog is the text floor.** No token may be added below it.
- **Ash is never text.** At 3.45:1 it fails AA at every body size. It is the
  control boundary and the inactive-tab label, and nothing else.
- **Bone is the default ink, not paper.** Paper is the hero headline and
  inline emphasis.
- **The ink on ember is void.** Bone on ember measures 2.64:1 and fails.
- **Ember is spent, not spread.** The primary CTA fill, the editorial card's
  2px left border, the shipping stage tag, the terminal turn marker, and the
  focus ring. Ordinary text, icons and borders never take it.
- **The three states report machine outcomes only.** Teal is running and log
  bars, green is passed, red is failed. No button, border, link or label takes
  one, and there is no filled status badge — the glyph and the word carry the
  state, and the colour confirms it.
- **A hairline is not a control boundary.** Graphite measures 1.30:1 on void —
  correct for separating two static surfaces, and a fail under SC 1.4.11 for
  anything that needs an edge to be recognised as a control. An input's edge
  is ash, at 3.45:1.

The boundary rule in one line: **a card may use a hairline, an input may not.**
A card is identified by its content; an input is identified by its edge.

Backgrounds must be flat. There is no gradient anywhere in the system — the
previous system's hero text gradient is retired. Hover and active fields are
derived, not tokenized:

```css
/* Colour change only, and it adds no token. */
background: color-mix(in oklch, var(--color-paper) 6%, transparent); /* hover */
background: color-mix(in oklch, var(--color-paper) 10%, transparent); /* active */
```

A token belongs to one role. Reusing another role's token because it is the
right colour today welds the two together: when that role's colour changes,
this element changes with it and nobody knows why. Add a token for the new
role instead, or read the one that names what this element is.

Shadows do not carry depth. Depth is a hairline and a tonal step — void to
carbon to graphite. The one shadow the system carries,
`rgba(0, 0, 0, 0.05) 0 1px 2px`, is a hairline's worth of grounding under a
small control, and nothing else may cast.

### 2.4 Typography

| Token                  | Value      | Role                                |
| ---------------------- | ---------- | ----------------------------------- |
| `font.family.sans`     | Geist      | Prose, UI, headings, controls       |
| `font.family.mono`     | Geist Mono | Code, transcripts, labels, metadata |
| `font.size.base`       | 16px       | Body                                |
| `font.lineHeight.base` | 1.6        | Body                                |
| `font.weight.base`     | 400        | Prose                               |
| `font.weight.medium`   | 500        | Headings, buttons, emphasis         |

Two faces of one family, so metrics, x-height and letterforms agree. **The rule
that decides every case: if a machine produced the text it is set in the mono;
if a person is being spoken to it is set in the sans.** That one line styles the
transcript, the metadata row, the eyebrow and the code block without a per-case
decision.

Every size must land on the scale below and take that step's line height. A
size that does not land on a step snaps to the closest step below. Arbitrary
values such as `text-[19px]`, `font-size: 22px`, `1.4rem` or any `clamp()` are
defects.

| Step                  | Size | Weight | Line height | Face | Used for                               |
| --------------------- | ---- | ------ | ----------- | ---- | -------------------------------------- |
| `--text-code`         | 13px | 400    | 1.6         | Mono | Code, transcripts, tables              |
| label / eyebrow       | 13px | 400    | 1.4         | Mono | Tags, stage tags, metadata — uppercase |
| `text-[13px]` caption | 13px | 400    | 1.4         | Sans | Captions, fine print                   |
| `text-[15px]`         | 15px | 400    | 1.5         | Sans | Dense UI, nav, buttons, web rows       |
| `text-base`           | 16px | 400    | 1.6         | Sans | Body — the reading size                |
| `text-lg`             | 18px | 400    | 1.6         | Sans | Lede                                   |
| `--text-subheading`   | 20px | 500    | 1.4         | Sans | Card headline — `.d-3`                 |
| `--text-heading-sm`   | 24px | 500    | 1.25        | Sans | Docs h2, panel title — `.d-2`          |
| `--text-heading`      | 32px | 500    | 1.15        | Sans | Docs h1, sub-section — `.d-1`          |
| `--text-heading-lg`   | 40px | 500    | 1.1         | Sans | Section headline                       |
| `--text-display`      | 56px | 500    | 1.05        | Sans | Marketing hero — `.d-hero`             |

**Body is 16px at 1.6.** It is the one value in this system chosen purely for
long-form legibility. Dense product surfaces step down to 15px; nothing goes
below 13px anywhere.

Tracking is two tokens, not a per-step value: `--tracking-reading` at
-0.011em for every size up to the lede, and `--tracking-display` at -0.022em
for every heading. The mono never tracks negative — `--tracking-label` opens
it to +0.06em. A literal `letter-spacing` in `typography.css` fails the build.

Rules:

- Never set type in italic, anywhere, on either surface. Emphasis is colour,
  size or weight.
- Never use a weight above 600, and never carry a heading past 500.
- Uppercase belongs to the mono label row alone. Everything else is sentence
  case, never title case.
- No hyphen may appear inside a sentence, a heading or a label. Rewrite the
  phrase. This governs copy rendered on either site. It does not govern this
  file, code identifiers, CSS property names, or command syntax. One exemption
  is on the record: `AI-native`, in the product tagline and wherever the
  product is described. Recorded in [decisions.md](decisions.md); no second
  exemption without one.
- No word may sit alone on the last line. Headings set `text-wrap: balance`;
  body copy sets `text-wrap: pretty`; long-form documentation prose sets
  neither.
- Code sets tabular figures and a slashed zero, and is one token
  (`--text-code`), so the same command is one size on both sites.
- Body measure must not exceed 680px. A block that breaks out must opt in
  explicitly and must re-measure.
- Tabular figures go on **every value that changes** and in every table: a
  timer, a counter, a star count, a version.
- Copy is stored in its natural case and presented with `text-transform`. A
  label is written as a sentence and uppercased by CSS, so the text a screen
  reader announces and the text a search engine indexes are the real words.
- Punctuation is typographic: curly quotes, an en dash for a range, an em dash
  for an aside, and the single ellipsis character.
- Arrow glyphs are text set in the face: `→` after an action label, `~/` as
  the hero prompt. They are never drawn.
- Underlines set `text-underline-position: from-font` and
  `text-decoration-skip-ink: auto`. Colour does not distinguish a link in this
  system, so the underline is what does, and it is mandatory.
- A long word breaks rather than escaping its column: `overflow-wrap:
break-word` on prose, and `white-space: nowrap` on a label or a badge that
  must stay on one line.
- Font smoothing is declared once, on the root, and never per component.
- Truncated text must keep its full value reachable, in a tooltip or an
  expanded view.

### 2.5 Spacing

Base unit 4px, on Linear's grid. Only these values. Nothing between them,
nothing outside them.

| Token        | Value | Token         | Value |
| ------------ | ----- | ------------- | ----- |
| `spacing.4`  | 4px   | `spacing.32`  | 32px  |
| `spacing.8`  | 8px   | `spacing.40`  | 40px  |
| `spacing.12` | 12px  | `spacing.48`  | 48px  |
| `spacing.16` | 16px  | `spacing.64`  | 64px  |
| `spacing.20` | 20px  | `spacing.80`  | 80px  |
| `spacing.24` | 24px  | `spacing.96`  | 96px  |
|              |       | `spacing.128` | 128px |

Buttons take 8px of vertical padding and 16px of horizontal padding, landing
at about 36px tall.

Page-level values:

| Value           | Size   | CSS property          | Note                                 |
| --------------- | ------ | --------------------- | ------------------------------------ |
| Container       | 1200px | `--container-page`    | Centred, with a gutter either side   |
| Measure         | 680px  | `--container-measure` | Hero heading, subheading, and prose  |
| Card padding    | 24px   | —                     | Feature panel 32px, quote block 16px |
| `section-tight` | 40px   | `.section-y-tight`    | A run of short related blocks        |
| `section`       | 80px   | `.section-y`          | The default band                     |
| `section-lg`    | 96px   | `.section-y-lg`       | A band that must stand alone         |

The container and the measure sit in Tailwind's container namespace, so they
answer as `max-w-page` and `max-w-measure`. A width typed as a raw value, or
taken from Tailwind's own `max-w-5xl` scale, is a defect.

The three section beats are marketing's rhythm. The documentation surface uses
the notebook layout's continuous rhythm and must not import them.

**Grouping is spacing.** The gap between two groups must be at least twice
the gap inside one: 4px within a row of links and 12px between that row and
the next control, 8px within and 16px between. Equal gaps everywhere read as
one long list, and the reader has to do the grouping the layout should have
done.

Use logical properties — `padding-inline`, `margin-block-start`,
`inset-inline-end` — rather than left and right. They are the same length in
this system today and the correct one the day a surface is not left to right.

A text container must not carry a fixed width or height. Cap it with
`max-width` and let the content decide the rest.

Every gap must be a token. A one-off value such as `margin-top: 13px` is a
defect even when it looks correct. Vertical padding should be adjusted
optically; the bottom of a band usually needs one step more than the top.

### 2.6 Radius

Five values, on Linear's range:

| Token          | Value  | Use                                               |
| -------------- | ------ | ------------------------------------------------- |
| `rounded-sm`   | 2px    | Inline code, badges, the floor for a nested shape |
| `rounded-md`   | 6px    | Buttons, inputs, small controls, popovers         |
| `rounded-lg`   | 12px   | Cards, code blocks, the transcript panel          |
| `rounded-xl`   | 16px   | A full-bleed feature panel                        |
| `rounded-full` | 9999px | Avatars, stage tags, icon badges                  |

Axiom's 2px-everywhere was rejected on the same grounds as its type scale: at
a 36px control a 2px corner reads as an unfinished rectangle, and 6px is the
smallest radius that reads as deliberate. The 2px floor is kept for small
nested shapes. The shadcn bridge sets a bare `--radius` at the control step,
which is what the components' radius arithmetic reads.

**Nested radius.** When a shape sits inside another and the gap between them
is under 32px:

```
inner radius = outer radius − gap
```

Apply only when the result is above 2px. Below that the inner shape stays
square.

### 2.7 Motion

Never use a default transition. Every transition uses a custom curve.

| Token           | Value                               | Use                                |
| --------------- | ----------------------------------- | ---------------------------------- |
| `--ease-fluid`  | `cubic-bezier(0.32, 0.72, 0, 1)`    | Every transition                   |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | A control that must feel physical  |
| `--dur-instant` | 150ms                               | Hover, focus, active               |
| `--dur-fast`    | 300ms                               | Popover, dropdown, disclosure      |
| `--dur-base`    | 700ms                               | The default transition             |
| `--dur-reveal`  | 800ms                               | An element entering the viewport   |
| `--stagger`     | 50ms                                | The step between revealed siblings |

**Never `transition: all`.** Name the exact properties that change. `all`
animates every property that happens to differ, including ones the browser
computes later, so a change nobody asked for animates and a change that
mattered is buried among them.

Tailwind's own transition utilities fall back to a default duration and a
default curve. `tokens.css` re-points `--default-transition-duration` and
`--default-transition-timing-function` at the table above, so a bare
`transition-colors` lands on the system rather than off it. A micro
interaction may run at `instant`, but never below 150ms.

**Scroll reveal.** An element entering the viewport moves from
`translate-y-16 blur-md opacity-0` to `translate-y-0 blur-0 opacity-100` over
`duration-reveal` or longer. Siblings stagger by `--stagger`.

Rules:

- Buttons move by colour change only — no lift, no shadow, no translate.
  The 0.98 press is the one transform a button carries.
- Reveals must use `IntersectionObserver`. `window.addEventListener('scroll')`
  is a defect; it causes continuous reflow and destroys mobile performance.
- Animate `transform` and `opacity` only. Animating `top`, `left`, `width` or
  `height` is a defect.
- Entrance motion is a marketing capability. Documentation uses `instant` and
  `fast` only.
- All motion must be removed under `prefers-reduced-motion: reduce`. An
  opacity change may remain; a transform must not.
- No animation library may ship to the browser. The system is CSS.
- A hidden start state must be gated behind the `.js` class, so a reader
  without JavaScript sees the content.
- `scroll-behavior: smooth` must be set for anchor navigation, and an
  anchored heading sets `scroll-margin-block-start` so it does not land under
  the sticky region above it.
- **Use a transition for an interaction and keyframes for a sequence.** A
  transition can be interrupted half way and will run back from where it got
  to; an animation restarts.
- **Do not animate a high-frequency interaction.** The colour of a row in a
  list on hover, a value that ticks: animating these makes a list feel wet and
  costs a paint per frame per row.
- `will-change` names only `transform`, `opacity` or `filter`, and only while
  the property is actually about to change.
- **Cross-fade an icon that swaps.** The entering icon runs scale 0.25 to 1,
  opacity 0 to 1 and blur 4px to 0; the leaving one runs the same in reverse.
  A control whose two states are one shape moving — the menu button — morphs
  instead, which is better still.

### 2.8 Focus

One focus treatment, both surfaces, every component:

```css
:focus-visible {
  outline: 2px solid var(--color-ember);
  outline-offset: 2px;
  border-radius: inherit;
}
```

- Focus must use `:focus-visible`, never `:focus`. A mouse click must not
  paint a ring.
- `outline: none` without a replacement of equal or greater visibility is a
  defect. There are no exceptions.
- The 2px offset must not be clipped. An ancestor with `overflow: hidden` and
  a focusable descendant at its edge is a defect.
- The ring measures 5.55:1 against the void, above the 3:1 that SC 1.4.11
  requires.

It is authored once, in
[packages/ui/src/styles/tokens.css](../packages/ui/src/styles/tokens.css),
and deliberately left outside `@layer base` so a component cannot quietly
outrank it.

### 2.9 Icons

- Icons must come from **Phosphor**, **Solar** or **Iconamoon**.
- Lucide, Feather, Material Icons and Material Symbols are defects. They are
  the default choices and they read as one.
- Every icon must use one stroke weight across the whole system, drawn in
  `mist` where the stroke is the detail and `paper` where the icon is the
  control.
- Avoid the cliché metaphor. A rocket for launch and a shield for security are
  defects; use bolt, fingerprint, spark or vault.
- An icon beside text often needs one or two pixels of optical correction.
  Align it by eye, not by box.

### 2.10 Optical craft

Three rules that a measurement will not give you.

**Align optically, not geometrically.** A box centred by its bounding box is
not centred by what a reader sees. A play triangle, a glyph with a long
descender, an icon with more mass on one side: each needs a nudge the maths
does not ask for. Centre by eye and keep the nudge.

**Sharp corners meet sharp corners.** Everything is 2px, so nested shapes do
not negotiate radii — the inner shape stays square. The one curve in the
system is the icon badge's circle, and nothing sits inside one.

**An image carries its own edge.** A dark capture on the void merges into it.
Give it a 1px outline offset by `-1px` — white at 8% — which draws inside the
box and never grows it. This is an outline, not a shadow, and it is the only
edge an image gets.

## 3. Component rules

Each component is marked **shared**, **marketing**, or **docs**. A shared
component must render identically on both surfaces.

### 3.1 The shared state model

Every interactive element must define all seven states. A component shipped
without them is incomplete.

| State         | Requirement                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Default       | Resting. No elevation, no shadow.                                                                                                         |
| Hover         | Colour change only. Pointer only; never the sole carrier of information.                                                                  |
| Focus-visible | The ring from 2.8. Must be reachable by keyboard alone.                                                                                   |
| Active        | `scale(0.98)` for physical feedback. Must be distinct from hover.                                                                         |
| Disabled      | 45% opacity, `aria-disabled="true"`, pointer events off. Must stay focusable so a screen reader can find it and read why.                 |
| Loading       | A skeleton shaped like the real layout, never a circular spinner. `aria-busy="true"`. Width must not change.                              |
| Error         | Inline and specific, tied by `aria-describedby`, with `aria-invalid="true"`. Never `window.alert()`. Color must never be the only signal. |

**A control whose label changes reserves the width of its widest label.**
A copy button going to "Copied", a count ticking from 9 to 10: the control
resizes, and everything laid out around it moves. Render every option into
one grid cell and hide all but the current one with `visibility: hidden`,
which holds the box. Then set the accessible name explicitly with
`aria-label`, with the visible word inside that name, per SC 2.5.3.

Empty states are a composed "getting started" view, never a blank panel.

Disabled must use `aria-disabled`, not the `disabled` attribute, on anything a
reader might need to find. The `disabled` attribute removes the control from
the tab order and the explanation goes with it.

No dead links. A button pointing at `#` is either linked or visually disabled.
The current page must be indicated in the navigation.

### 3.2 Button — shared

**Anatomy.** Optional leading icon, label, optional trailing arrow glyph
(`→`) in the label's own colour. Gap 8px. Padding 8px vertical, 16px
horizontal. Radius `rounded-md`.

| Variant   | Type             | Field       | Text    | Border  | Budget per page |
| --------- | ---------------- | ----------- | ------- | ------- | --------------- |
| Primary   | `text-base`, 700 | `ember`     | `void`  | None    | One per view    |
| Ghost     | `text-base`, 400 | Transparent | `paper` | `slate` | Unlimited       |
| Header    | `text-sm`, 400   | Transparent | `fog`   | None    | Unlimited       |
| Icon-only | n/a              | Transparent | `ash`   | None    | Unlimited       |

The primary CTA is the conversion anchor and the one place weight 700 and
ember meet. The ghost is the default everywhere else; at the density a
documentation page carries, a filled button is noise.

A button that sits in a row of chrome takes the header step (`.btn-sm`)
instead of the body one, and changes nothing else. It is a size, not a
variant.

| State         | Ghost, header, icon-only                | Primary       |
| ------------- | --------------------------------------- | ------------- |
| Hover         | 6% bone wash; ghost's border to `smoke` | 8% lighten    |
| Focus-visible | Ring                                    | Ring          |
| Active        | `scale(0.98)`                           | `scale(0.98)` |
| Disabled      | 45% opacity                             | 45% opacity   |
| Loading       | Skeleton at resting width               | Same          |
| Error         | The form owns the error                 | Same          |

**Interaction.** `Enter` and `Space` must both activate. Pointer activation
fires on release inside the bounds, so a drag away cancels. Targets must be at
least 24×24 CSS pixels, and should be 44×44 where layout allows. Touch must
not depend on hover to reveal a label.

**Responsive and edge cases.**

- An icon-only button must carry `aria-label`. A `title` is not a substitute;
  it does not reach touch users.
- A long label must wrap to two lines, not truncate. A truncated action is an
  ambiguous action.
- Loading must reserve the resting width, or the layout moves under the
  pointer.
- Below 768px, a row of more than two buttons must stack full width.
- In a card group, CTAs must be pinned to the bottom so they form one clean
  horizontal line.

### 3.3 Link — shared

**Anatomy.** Text, optional trailing `→` glyph or external-link icon at
`text-xs`.

| Variant      | Surface   | Treatment                                                               |
| ------------ | --------- | ----------------------------------------------------------------------- |
| Inline prose | Both      | `paper`, 1px underline, no weight change                                |
| Navigation   | Both      | `fog`, underline on hover                                               |
| Rule link    | Marketing | Underline grows from 0% to 100% width on hover, drawn in `currentColor` |
| Chevron link | Both      | Underlined `paper` followed by `→` in the same colour                   |
| Sidebar leaf | Docs      | `text-xs`, `ash`; current page in `paper` with an ember left rule       |
| TOC          | Docs      | `text-sm`, `ash`; active heading in `paper`                             |
| External     | Both      | Inline treatment, plus icon and `rel="noreferrer"`                      |

**States.** Hover underlines, grows the rule to full width, or brightens fog
to paper. Focus-visible paints the ring. Active drops to 80% opacity.
Disabled is not a link; render text. Loading is a prefetch in flight and must
produce no visual change. Error means the target 404s, which the router must
resolve to the custom 404 page.

**Interaction.** Links must be `<a href>`. A `div` with a click handler is a
defect. `Enter` activates; `Space` must not. Middle-click and modifier-click
must open a new tab, which rules out `preventDefault` on plain navigation.

**Responsive and edge cases.**

- A link inside prose must carry more than colour alone: the underline is the
  minimum; SC 1.4.1 forbids colour alone, and here the colour does not even
  differ.
- A long URL used as link text must wrap with `overflow-wrap: anywhere`.
- At 31 links per page, weight must stay 400. Bold links are a defect.
- The current sidebar item must carry `aria-current="page"`.

### 3.4 List — shared

**Anatomy.** Marker, content, optional nested list. Item gap 8px. Nested
indent 16px.

**Variants.** Unordered with an `ash` marker; ordered with tabular figures so
numbers align; definition lists for option and flag reference; task lists
with a non-interactive checkbox.

**States.** A static list has default only. A list of links inherits every
link state per item, not per list.

**Responsive and edge cases.**

- Nesting must stop at three levels. Deeper content is a table or a new page.
- A list item holding a code block must keep the block inside the content
  column, not under the marker.
- Long items must wrap; the marker stays on the first line.
- An empty list must not render. Render nothing, or the empty state in 5.3.
- In pricing or comparison columns, feature lists must start at the same Y
  position. Use fixed-height title and price blocks.

### 3.5 Card — shared

**Anatomy.** Optional tag, title at `heading-sm`, description in `fog`,
optional footer. Padding 24px. Inner gap 12px. Radius `rounded-lg`. Border 1px `graphite`
on all four sides. Field `carbon`.

A single-sided border is never a card edge — with one exception: the
editorial card's 2px `ember` left border, the case mark, which is a category
tag and the only colour in the card.

**Variants.** Static; link card, where the whole card is one target;
elevated, on `graphite` with the case mark; and transcript card, which is the
`panel-terminal` component on `carbon`.

**States.** Hover moves the border to `slate`. Focus-visible paints the ring
around the card, not the title. Active applies `scale(0.98)`. Loading shows a
skeleton at the resting height. Error replaces the body with a message and a
retry button, and keeps the card frame.

Cards must have no shadow, and a card should exist only where a tonal step
communicates hierarchy.

**Interaction.** A link card must contain exactly one focusable element. Use a
stretched pseudo-element from the title link, not a nested set of tab stops.

**Responsive and edge cases.**

- A three equal column feature row is the most generic layout there is. Three
  to five benefits is correct as content; the layout should be a two column
  zig zag, an asymmetric grid, or masonry.
- Cards in a grid must allow variable height, not truncate text to match.
- A title of more than two lines must wrap, not clamp.
- Below 768px a card grid collapses to one column and hover effects are
  dropped; there is no hover on touch.
- An empty card grid must render the empty state, not a lone border.

### 3.6 Navigation — per surface

**Marketing: the bar.** One docked full-width bar on `void` with an `graphite`
hairline below and a backdrop blur once content scrolls beneath it. It holds
the wordmark, section links in the header step, and one primary CTA. No
island, no pill, no mega-menu.

- The hamburger lines must rotate and translate into a true X with `rotate-45`
  and `-rotate-45`. They must never simply disappear or swap glyph.
- The menu opens as a screen-filling overlay with `backdrop-blur-3xl` over
  `bg-void/80`, not as a dropdown.
- Links inside the overlay stagger in from `translate-y-12 opacity-0` to
  `translate-y-0 opacity-100`, one `--stagger` step apart.
- The bar must not obscure a focused element. See check B4.

**Documentation.** Three regions, each a distinct landmark with its own name:

| Region       | Element                                   | Name          | Contents                              |
| ------------ | ----------------------------------------- | ------------- | ------------------------------------- |
| Top bar      | `<header>` with `<nav aria-label="Main">` | Main          | Wordmark, tab row, search, repository |
| Sidebar      | `<nav aria-label="Documentation">`        | Documentation | Page tree, collapsible groups         |
| On this page | `<nav aria-label="On this page">`         | On this page  | Heading TOC                           |

**States.** Each item follows the link states in 3.3. A collapsible group adds
`aria-expanded`. The active tab carries `aria-current="page"`. The TOC active
item is driven by an `IntersectionObserver` and falls back to the first
heading when no observer runs.

**Interaction.**

- A skip link must be the first focusable element on both surfaces and must
  jump to the main content.
- Documentation `Tab` order: skip link, top bar, sidebar, article, TOC.
- Arrow keys must not trap focus in the sidebar tree. It is a list of links,
  so `Tab` moves and `Enter` activates.
- The search trigger must open on `Cmd+K` and `Ctrl+K`, close on `Escape`, and
  return focus to the trigger.
- The search dialog must trap focus while open and must set `aria-modal`.
- Below 1024px the sidebar becomes a drawer. It must trap focus, close on
  `Escape`, and restore focus to the toggle.

**Responsive and edge cases.**

- A deep page tree must scroll inside the sidebar, not the page.
- A heading longer than the TOC column must wrap to two lines, then clamp.
- With one heading on a page the TOC must not render.
- There is no theme control. The system is dark only, and a control that
  offers a choice that does not exist is a defect.

### 3.7 Code block and command snippet — shared

**Anatomy.** Optional filename or channel bar, the code, and a copy button in
the top right. `--text-code`. Radius `rounded-lg`. Field `carbon` with an `graphite`
hairline, so a code block and the transcript panel are the same surface the
program itself draws.

**States.** The copy button is quiet (`ash`, hover `paper`) and must be
visible without hover. Focus-visible paints the ring. On success the label
changes to "Copied" and announces through an `aria-live="polite"` region.
Error announces "Copy failed" and reveals a selectable fallback.

**Responsive and edge cases.**

- Long lines must scroll horizontally inside the block. The page body must
  never scroll horizontally.
- The scroll container must be focusable and must carry `role="region"` with a
  label, so keyboard users can scroll it.
- Line wrapping must be off by default. A wrapped shell command is a mistyped
  shell command.
- The copy button must never overlay the first line. Reserve the gutter.
- A block must declare its language, and must degrade to plain text when the
  language is unknown.
- A timed state reset must be at least 1500ms, so the announcement completes.

### 3.8 Tab set — shared

Used by the install channel switcher on marketing and the tab row on
documentation.

**Anatomy.** A `role="tablist"`, one `role="tab"` per channel, one
`role="tabpanel"`. Labels at `text-xs`, uppercase.

**States.** The selected tab carries `aria-selected="true"`, `paper` text and
a `paper` underline; the rest are `fog`. Hover moves an unselected tab to
`paper`. Focus-visible paints the ring. Loading and error belong to the
panel, not the tab.

**Interaction.**

- Arrow keys must move between tabs; `Home` and `End` jump to the ends.
- Only the selected tab is in the tab order. `Tab` from the tablist moves into
  the panel.
- Each tab must control its panel through `aria-controls`.
- The selected state must be carried by more than color. The underline is
  required.

**Edge cases.** With one channel, render no tablist. A channel whose content
fails to load must show the error inside the panel and keep the tabs usable.

### 3.9 Disclosure — shared

Used by the marketing FAQ and by collapsible groups in the documentation
sidebar.

**Anatomy.** A `<details>` element with a `<summary>` trigger and a chevron.
Summary at `text-sm`, weight 400. A 1px `graphite` divider between items. A
divider between rows is not a card border and is permitted.

**States.** Closed by default. Hover is the 6% bone wash. Focus-visible
paints the ring on the summary. Open rotates the chevron over `--dur-fast` on
`--ease-fluid`.

**Interaction.** `Enter` and `Space` must toggle. The native element provides
this; a custom re-implementation is a defect.

**Edge cases.**

- The open state must be visible without color. A chevron or a plus-minus mark
  is required; a color change alone fails SC 1.4.1.
- `list-style: none` on the summary removes the native marker, so a chevron
  must be supplied in the same change.
- Content inside a closed disclosure must remain in the document, so search
  and agents can read it.
- A disclosure must not hold information a reader needs in order to act.

### 3.10 Callout — docs

**Anatomy.** Icon, optional title, body at `text-sm`. Padding 16px. Radius
`rounded-md`. Field `carbon`.

| Variant | Treatment                                       | Body text |
| ------- | ----------------------------------------------- | --------- |
| Note    | 1px `graphite` border on all four sides         | `paper`   |
| Tip     | The case mark: a 2px `ember` left border        | `paper`   |
| Warning | 1px `smoke` border on all four sides, plus icon | `paper`   |

Body text must be `paper` in every variant. State is a symbol, a word, and a
border treatment — never a colour fill, and never colour alone.

**States.** Static. A dismissible callout must keep a focusable close button
and must not hold content a reader needs twice.

**Edge cases.** A callout must not nest, and must not be the only place a
constraint appears; a reader scanning headings will miss it.

### 3.11 Hero — marketing

**Anatomy.** The `~/` prompt in `ash`, a two-line `h1`, subheading, one
primary CTA with one ghost action beside it, one proof signal, and the real
program full-width below.

- The `h1` is flat `paper` at the display step. There is no gradient.
- The `h1` and the subheading both cap at 680px.
- Line breaks in the `h1` are placed by hand, where the thought breaks. A
  break that splits a phrase awkwardly is a defect.
- Type climbs `heading-lg` to `display` at 768px — 24px to 32px. A terminal
  does not shout.
- One primary action. A competing CTA above the fold is a defect.
- The arrow field — repeating `>` glyphs in `slate` — may fill the negative
  space, masked so it fades rather than stopping.

### 3.12 Tagline reveal — marketing, mandatory

Every marketing page carries one large-type band stating the core benefit,
separate from the hero and further down the page. It is its own moment, never
stacked directly under the hero.

- **Copy.** Minimum two lines. A benefit statement in the product voice, not a
  generic section heading.
- **Type.** `heading-lg` to `display`, capped at 680px with meaningful line
  breaks.
- **Animation.** Words start at 30% opacity of `paper` and reach full color
  one at a time, in reading order, as each crosses the trigger line. The
  block must not flip at once. The transition uses `--ease-fluid`, never a
  linear fade.
- **Implementation.** One `IntersectionObserver` per word. An unthrottled
  scroll listener is a defect.
- Under `prefers-reduced-motion: reduce` every word renders at full color
  immediately.

### 3.13 Section, tag and stage tag — marketing

**Section.** A band with one of the three beats from 2.5, an optional
arrow-field ground, and a 1200px container with a 24px gutter. A section must
carry exactly one `h2`. Everything centred and symmetrical is the generic
layout; break symmetry with offset margins, mixed aspect ratios, or a left
aligned header over centred content.

**Tag (eyebrow).** Pure typography: `text-xs`, uppercase, `ash`, no border,
no fill, no mark. It is a label, not a heading, and must not be marked up as
one.

**Stage tag.** The same anatomy. When the capability is shipping, the text
takes `ember`. The text names the stage; color never carries it alone.

Every capability that has not shipped must carry a stage tag. A screenshot of
an unshipped capability is not evidence.

## 4. Accessibility requirements and acceptance criteria

Target: WCAG 2.2 AA, both surfaces. Each row is a pass/fail check that a
reviewer or a test can run.

### 4.1 Perceivable

| ID  | Criterion                | Check                                                               | Pass                                                          |
| --- | ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| A1  | 1.4.3 Contrast           | Measure every text-and-field pair                                   | ≥ 4.5:1 normal, ≥ 3:1 at 18.66px bold or 24px                 |
| A2  | 1.4.11 Non-text contrast | Measure focus ring, control border, icon against the adjacent field | ≥ 3:1                                                         |
| A3  | 1.4.1 Use of color       | Grayscale the page                                                  | Every link, state, selection and status is still identifiable |
| A4  | 1.4.4 Resize text        | Zoom to 200%                                                        | No loss of content or function                                |
| A5  | 1.4.10 Reflow            | Viewport 320px wide                                                 | No horizontal page scroll; only code blocks scroll            |
| A6  | 1.4.12 Text spacing      | Line 1.5×, paragraph 2×, letter 0.12em, word 0.16em                 | No clipping, no overlap                                       |
| A7  | 1.4.13 Hover content     | Hover a tooltip, then move onto it                                  | Hoverable, dismissible with `Escape`, persistent              |
| A8  | 1.1.1 Non-text content   | Inspect every image and icon                                        | Meaningful ones have text; decorative ones have `alt=""`      |

### 4.2 Operable

| ID  | Criterion                 | Check                                        | Pass                                                   |
| --- | ------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| B1  | 2.1.1 Keyboard            | Complete every task with the mouse unplugged | All tasks complete                                     |
| B2  | 2.1.2 No trap             | `Tab` through the whole page                 | Focus leaves every region, including the search dialog |
| B3  | 2.4.7 Focus visible       | `Tab` through the whole page                 | A ring is visible on every stop                        |
| B4  | 2.4.11 Focus not obscured | `Tab` with the sticky bar present            | No focused element is fully hidden behind it           |
| B5  | 2.5.8 Target size         | Measure every control                        | ≥ 24×24 CSS px, or 24px clear spacing                  |
| B6  | 2.4.1 Bypass blocks       | Load and press `Tab` once                    | A skip link appears and reaches the main content       |
| B7  | 2.4.3 Focus order         | `Tab` through the page                       | Order matches the visual and reading order             |
| B8  | 2.5.7 Dragging            | Find every drag interaction                  | None exists, or a single-pointer alternative does      |
| B9  | 2.3.1 Flashes             | Review all motion                            | Nothing flashes more than three times per second       |

### 4.3 Understandable and robust

| ID  | Criterion                    | Check                                | Pass                                                     |
| --- | ---------------------------- | ------------------------------------ | -------------------------------------------------------- |
| C1  | 3.2.6 Consistent help        | Compare pages across both surfaces   | Help and repository links sit in the same relative order |
| C2  | 3.3.7 Redundant entry        | Review any multi-step input          | Nothing already supplied is asked for twice              |
| C3  | 3.1.1 Language               | Inspect `<html>`                     | `lang` is set                                            |
| C4  | 2.4.2 Page titled            | Inspect `<title>`                    | Unique and descriptive per page                          |
| C5  | 1.3.1 Info and relationships | Run the accessibility tree           | Headings, lists and landmarks are real elements          |
| C6  | 4.1.2 Name, role, value      | Inspect every control                | Each has an accessible name and a correct role           |
| C7  | 2.2.2 Pause, stop, hide      | Set `prefers-reduced-motion: reduce` | All transform motion is removed                          |
| C8  | 4.1.3 Status messages        | Copy a command                       | The result announces without moving focus                |

### 4.4 Structural rules

- Exactly one `h1` per page. On marketing it is the hero; on documentation it
  is the page title.
- Heading levels must not skip. An `h4` under an `h2` is a defect.
- Every landmark region must have a unique accessible name.
- Semantic HTML only: `<nav>`, `<main>`, `<article>`, `<aside>`, `<section>`.
  Div soup is a defect.
- Content must render without JavaScript on both surfaces.
- `min-height: 100dvh` for full-screen sections, never `height: 100vh`.
- `z-index` comes from a scale in the theme. An arbitrary `9999` is a defect.

### 4.5 Control and input rules

- A hit area is at least 24×24 CSS px, should be 40×40 on desktop and 44×44 on
  touch. An extended hit area must never overlap another one; two controls
  whose padding collides give the reader a coin toss.
- Hover styling lives behind `@media (hover: hover)`. On touch `:hover` sticks
  after a tap, so the last thing a reader touched keeps looking selected. The
  `hover:` variant is redefined in `tokens.css` so every call site is gated.
- A decorative element — the arrow field, a blur layer — sets
  `pointer-events: none`, or it swallows the click meant for the control
  underneath it.
- `aria-hidden="true"` never goes on a focusable element. It creates a stop
  that announces nothing.
- Only `tabindex="0"` and `tabindex="-1"`. A positive value rewrites the tab
  order of the whole page from one component.
- Alt text is written by purpose, not by appearance: `alt="Search"` on a
  search button, never `alt="magnifying glass"`. Decorative images take
  `alt=""`.
- Every input has a real `<label>`, a `type`, and an `inputmode`. Paste is
  never blocked; people paste passwords and one-time codes.
- Submit stays enabled until the request starts. Validate on submit, then set
  `aria-invalid="true"`, point `aria-describedby` at the message, and move
  focus to the first invalid field.
- A tooltip on a `disabled` control never opens for keyboard or touch. Put the
  explanation in visible text beside it, or use `aria-disabled="true"` so the
  control stays focusable.
- `role="status"` for a routine update, `role="alert"` only for an urgent
  error. An alert interrupts whatever the reader is doing.

## 5. Content and tone standards

Voice: concise, confident, implementation-focused. Write in ASD-STE100
Simplified Technical English. One idea per sentence. Active voice. Present
tense. Sentence case. Marketing may be shorter and more declarative; it must
not become vaguer.

### 5.1 Labels and actions

A label must name the outcome, not the mechanism.

| Do                      | Don't         | Why                            |
| ----------------------- | ------------- | ------------------------------ |
| `Copy page as Markdown` | `Click here`  | Names the outcome              |
| `Install Eva`           | `Get started` | Says which action              |
| `Connect a model`       | `Setup`       | A verb and an object           |
| `View on GitHub`        | `Link`        | Distinguishable out of context |
| `Copied`                | `Success!`    | Says what happened             |

An action label must be unique on the page, or distinguishable by its
accessible name. Four buttons named "Copy" is a defect.

- Start a button label with a verb. "Save draft", "Delete project" — never
  "OK" or a bare "Yes".
- A confirmation repeats the consequence: "Delete project" beside "Cancel",
  so the destructive choice is named on the button that does it.
- One word per flow. "Continue" or "Next", the same one at every step, never
  both in the same sequence.
- A toggle is labelled with the state it turns **on**: "Send read receipts",
  never "Disable read receipts". A label that describes the off state inverts
  every time the control moves.
- Address the reader as "you". Never "the user" — the reader is not a third
  party to their own session.

### 5.2 Errors

An error must say what happened, why, and the next action.

- Do: `No API key found. Eva reads ANTHROPIC_API_KEY from the environment. Set
it, then run eva again.`
- Don't: `Authentication failed.`

An error must not blame the reader, must not apologise, and must never open
with "Oops". A success message must not carry an exclamation mark.

### 5.3 Empty states

An empty state must say what is missing and how to fill it.

- Do: `No results for "trust scope". Try "trust", or browse the Configure
section.`
- Don't: `Nothing here.`

### 5.4 Content realism

Filler is the clearest signal that a page was generated rather than made.

| Never                             | Instead                                        |
| --------------------------------- | ---------------------------------------------- |
| Lorem Ipsum                       | Real draft copy                                |
| `John Doe`                        | Diverse, realistic names, a unique avatar each |
| `Acme Corp`, `Nexus`, `SmartFlow` | Contextual, believable names                   |
| `99.99%`, `50%`, `$100.00`        | Organic data: `47.2%`, `$99.00`                |
| Identical blog dates              | Varied, plausible dates                        |
| Stock "diverse team" photography  | Real screenshots or one illustration style     |

Banned words, on both surfaces: Elevate, Seamless, Unleash, Next Gen, Game
changer, Delve, Tapestry, and "In the world of".

Vague value propositions are defects. "Streamline" and "optimize" say nothing.
Write the measurable outcome instead: "Cut weekly reporting from 4 hours to 15
minutes".

Every feature line must state what it means for the reader. Proof must sit
next to the claim it supports, never only at the bottom of the page.

### 5.5 Honesty

- A capability that has not shipped must carry a stage tag naming its roadmap
  stage.
- Neither surface may describe a flag, command or option that does not exist
  in the released build.
- A number must come from a measurement. `Fast` is a claim; `120ms at p50` is
  evidence.
- The product tagline is one string in
  [packages/ui/src/site.ts](../packages/ui/src/site.ts). Neither surface
  may restate it in its own words.

### 5.6 Ship requirements

A page is not finished without these:

- Privacy policy and terms links in the footer
- A custom, branded 404, and a way back from every page
- Client-side validation for email format and required fields
- A skip to content link
- Cookie consent where the jurisdiction requires it — today neither surface
  sets a cookie, so no banner exists
- A branded favicon
- `<title>`, meta description, `og:image`, and social sharing tags
- Alt text on every meaningful image
- Ad-only and time-bound offers set to `noindex`; evergreen pages given a real
  title, meta description, internal links, and a plain question and answer FAQ

## 6. Anti-patterns and prohibited implementations

Each of these is a defect, not a preference.

**Tokens**

- A raw hex, `oklch()` or off-system Tailwind color utility in component code.
- A one-off spacing, size or radius value that is not in a scale.
- A token defined in a surface stylesheet rather than the brand package.

**Color and surfaces**

- Any gradient: linear, radial or mesh, on a background or on text.
- The purple and blue "AI gradient" aesthetic.
- A light surface anywhere, pure `#000000` as a ground, or pure `#ffffff` as
  the default ink.
- Text below `fog`, or any text in `ash`; it measures 3.45:1.
- Bone text on an ember fill; it measures 2.64:1.
- Ember on ordinary text, icons or borders — it belongs to the CTA fill, the
  case mark, the shipping stage tag, log bars and the focus ring.
- `teal`, `green` or `red` on anything that is not a machine outcome.
- Color as the only carrier of state, status, selection or link identity.
- A second accent color introduced to rank two kinds of importance.
- A colored fill as a status badge; state is a symbol, a word, and a border.
- A `box-shadow` used for depth.
- A dark field outside the three surface steps.

**Type**

- A third typeface, or any font loaded from a third-party origin.
- Long-form prose set in the mono, or machine output set in the sans.
- A literal `letter-spacing`; tracking is `--tracking-reading`,
  `--tracking-display` or `--tracking-label`.
- `text-wrap: pretty` or `balance` in long-form text.
- A straight quote, three periods for an ellipsis, or a hyphen used as a dash.
- Copy stored in the case it is displayed in rather than its natural case.
- Font smoothing set per component instead of once on the root.
- Italic type anywhere.
- A weight above 600, or a heading carried past 500.
- A `clamp()` or an arbitrary size such as `text-[19px]` or `1.4rem`.
- A hyphen inside a sentence, heading or label.
- A word left alone on the last line.
- Title Case On Every Header.
- Inline code and code blocks at different sizes.
- Body copy wider than 680px.

**Layout**

- Equal gaps inside and between groups.
- A fixed width or height on a text container.
- `left` and `right` where a logical property exists.
- A single-sided border on a card, except the ember case mark.
- A radius off the five-step scale.
- Three equal card columns as the feature row.
- `height: 100vh` instead of `min-height: 100dvh`.
- No max width container, or a hero heading over 680px.
- Feature lists in adjacent columns starting at different Y positions.

**Interaction**

- A hover style that is not behind `@media (hover: hover)`.
- A decorative element without `pointer-events: none`.
- `aria-hidden="true"` on a focusable element, or a positive `tabindex`.
- `role="alert"` for a routine update.
- Alt text that describes the picture rather than the purpose.
- A tooltip as the only explanation on a `disabled` control.
- Blocking paste in any field.
- `outline: none` without an equally visible replacement.
- `:focus` styling in place of `:focus-visible`.
- A `div` or `span` with a click handler in place of a button or link.
- A group of buttons acting as tabs without `role="tablist"` and arrow keys.
- `list-style: none` on a `<summary>` with no chevron supplied.
- A hamburger that swaps or disappears instead of morphing into an X.
- A mobile menu as a dropdown instead of a full overlay.
- The `disabled` attribute where the reader needs to find the control.
- A control that resizes when its own label changes.
- A theme control of any kind. There is no theme to choose.
- A target below 24×24 CSS pixels, or a hover-only affordance.
- A circular spinner where a skeleton belongs, or `window.alert()` for an error.
- A dead link pointing at `#`.

**Motion**

- `transition: all`, or any transition that does not name its properties.
- A default transition, a literal duration, or a literal easing.
- `window.addEventListener('scroll')` for a reveal.
- Animating `top`, `left`, `width` or `height`.
- A hover lift, translate or shadow on a button; buttons change colour only.
- Entrance motion on a documentation page.
- A hidden start state that JavaScript cannot undo.
- An animation library shipped to the browser.
- Animating a high-frequency interaction, such as a row's colour on hover.
- `will-change` on a property that is not `transform`, `opacity` or `filter`,
  or left on an element that is at rest.
- An icon replaced in one frame instead of cross-fading or morphing.

**Structure**

- More than one `h1`, or a skipped heading level.
- Two landmarks with the same accessible name.
- Div soup in place of semantic elements.
- Content that requires JavaScript to read.
- A local visual exception justified by "it looks better on this surface".

## 7. Adoption

The token layer, both app stylesheets, the terminal palette and the theme
machinery removal have landed with the system replacement. What is left is
listed below, with the reason each one is still open. When this section is
empty, delete it.

### 7.1 Still open

| #   | Gap                                                                                                                                                                                        | Change                                                                                                    | Rule          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------- |
| 9   | Neither app imports an icon set; the icons it owns are inline SVG at one stroke weight. Fumadocs ships `lucide-react` inside its own layout, and those icons reach the documentation page. | Replace the Fumadocs slots that render an icon, or accept the dependency and record it in the table in 0. | 2.9           |
| 10  | There is no terms page. The 404s, the legal link, and the privacy page have landed.                                                                                                        | Write it, or decide a site with no account and no payment does not need one, and record that.             | 5.6           |
| 28  | The sidebar, the table of contents, and the article carry their landmark names. The top bar is a Fumadocs `<header>` with no inner `<nav>`, so it is a banner rather than a named Main.    | Supply the layout's `header` slot, which means reimplementing the navbar, or accept the banner.           | 3.6, check C5 |

Each is a decision rather than a task, and each is blocked on the same thing:
the Fumadocs layout owns that DOM, and the change is a fork rather than a
setting. None of the three fails a check in section 4 today.

### 7.2 Rules for the adoption work

- A change must move a surface toward this file. A change that adds a surface
  exception is a change to this file first.
- Each numbered item should land as its own commit, so a regression is
  bisectable.
- After each item, run the QA checklist for the affected surface.
- Do not migrate frameworks or styling libraries to land any of this.

## 8. QA checklist

Run before merge, on the surface being changed.

**Tokens**

- [ ] No raw color, size, spacing or radius value in the diff
- [ ] Every new token exists in `packages/ui/src/styles/tokens.css`, in
      design.md, and in this file
- [ ] No token defined in a surface stylesheet
- [ ] Every dark field is one of the three surface steps
- [ ] No literal duration or easing; `tokens.test.ts` passes
- [ ] `bun run design:lint` reports 0 errors and 0 warnings

**Type and layout**

- [ ] Two faces, self-hosted; no italic anywhere; no literal tracking
- [ ] Prose in the sans, machine output in the mono
- [ ] No weight above 600, and no heading past 500
- [ ] Every size lands on a type scale step with that step's line height
- [ ] No `clamp()` and no arbitrary size in the diff
- [ ] `text-wrap: balance` on headings, `pretty` on body; no orphaned words
- [ ] No hyphen inside a sentence, heading or label
- [ ] Inline code and code blocks both at `--text-code`
- [ ] One `h1`; no skipped heading levels; sentence case
- [ ] Container 1200px, prose and hero capped at 680px; body at 16px/1.6
- [ ] Every radius is on the five-step scale
- [ ] No gradient, no shadow, no single-sided card border except the case mark
- [ ] No horizontal page scroll at 320px

**States**

- [ ] All seven states on every interactive element
- [ ] Hover is never the only carrier of information
- [ ] Selection is never carried by color alone
- [ ] Active gives physical feedback
- [ ] Disabled uses `aria-disabled` and stays focusable where it must
- [ ] Loading is a skeleton, not a spinner, at the resting size
- [ ] A control whose label changes holds its width, and names itself explicitly
- [ ] Error is inline and specific; no `window.alert()`
- [ ] Empty state is composed, not blank
- [ ] No dead links; the current nav item is indicated

**Motion**

- [ ] Every transition uses `ease-fluid` or `ease-spring`
- [ ] Reveals use `IntersectionObserver`, never a scroll listener
- [ ] Only `transform` and `opacity` are animated
- [ ] Buttons change colour only — no lift, no shadow
- [ ] No entrance motion on a documentation page
- [ ] All transform motion removed under `prefers-reduced-motion: reduce`

**Accessibility**

- [ ] Checks A1 to A8 pass
- [ ] Checks B1 to B9 pass
- [ ] Checks C1 to C8 pass
- [ ] Contrast measured, not estimated, for every new pairing
- [ ] Every changed component **looked at**, not only measured. A contrast
      number is blind to a field painted on the wrong element.
- [ ] Complete the page's main task with the mouse unplugged
- [ ] Ring visible on every tab stop, never hidden by the sticky bar
- [ ] Skip link is the first focusable element

**Craft**

- [ ] No `transition: all`; every transition names its properties
- [ ] Gaps between groups are at least twice the gaps inside them
- [ ] Hover is behind `@media (hover: hover)`; decorative layers are click-through
- [ ] Tabular figures on every changing value and in every table
- [ ] Smart punctuation; copy stored in natural case
- [ ] Images carry the inset hairline
- [ ] Action labels carry the `→` glyph where they lead somewhere

**Content and ship**

- [ ] No Lorem Ipsum, placeholder brand, round fake number, or banned word
- [ ] Every action label starts with a verb and names an outcome
- [ ] No duplicate accessible names on one page
- [ ] Errors state what, why, and next; no exclamation marks in success
- [ ] Unshipped capabilities carry a stage tag
- [ ] Every number traces to a measurement
- [ ] 404, legal links, form validation, favicon, meta tags, alt text
- [ ] Icons from Phosphor, Solar or Iconamoon at one stroke weight

**Cross-surface**

- [ ] A component shared with the other surface renders identically
- [ ] Nothing in the diff contradicts section 7
- [ ] Full content readable with JavaScript disabled
