# UI guidelines — missing studio

Implementation-ready, token-driven rules for the missing studio web surfaces:
the marketing site at `missing.studio` and the documentation site at
`docs.missing.studio`.

**Design intent, in one sentence:** missing studio ships an instrument, not a
poster, so both surfaces must spend their contrast, weight and motion on the
content and nothing else.

This file defines one system. It is not a description of what either site
renders today. Section 7 lists what each surface must change to conform.

Read [DESIGN.md](../DESIGN.md) first. That file is the normative token source.
This file is how those tokens become components.

"Must" marks a non-negotiable rule. "Should" marks a recommendation. Every
accessibility rule in section 4 is written as a pass/fail check.

## 0. Precedence and brand overrides

List of authorities govern this system, in order:

1. **The [interface cheat sheet](https://interfaces.dev/cheat-sheet).** Adopted
   in full, and the source of the craft rules throughout this file — the ones
   about how a thing is built rather than which token it reads.
2. **This file plus DESIGN.md.** They apply the rules above to missing studio.
3. **The surface.** A site implements; it never decides.

The cheat sheet is adopted whole, with three values overridden because
DESIGN.md already sets them. Each is a number, not a principle:

| Cheat sheet                          | Ours                         | Why                                                                                                              |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Stagger staged entrances about 100ms | 50ms, `--stagger`            | DESIGN.md's motion table sets it, and the reveal runs at 800ms where the sheet assumes a shorter one.            |
| Pressed scale at 200ms `ease-out`    | 150ms `--ease-fluid`         | The scale value, 0.98, is the sheet's. The duration and the curve come from the token table, which has no 200ms. |
| Cap long-form at 60 to 75 characters | 680px, `--container-measure` | The same rule in the unit the layout uses. At the body step it lands at about 75 characters.                     |

The house rules say the user wins where an explicit prompt conflicts with a
rule. Three brand constraints were tested against that clause. **Two override
and one conformed.** Each is listed with the cost of conforming instead, so
the choice can be revisited in one line.

| #   | House rule                                   | Override                                                        | Why                                                                                                                                                                                | To conform instead                                                                       |
| --- | -------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Fonts: Geist, Manrope, Geist Mono or Poppins | Space Grotesk                                                   | Self-hosted in `packages/ui`, and [brand.test.ts](../apps/docs/src/lib/brand.test.ts) fails the build on a third family or a CDN font. Space Grotesk is not on the forbidden list. | Swap the woff2 file and the two `@font-face` blocks. One commit, no rule change here.    |
| 2   | One typeface per site                        | Instrument Serif for display, Space Grotesk for everything else | The display face is the brand. The same test welds the count to exactly two.                                                                                                       | Drop the serif, set `h1` and `h2` in the primary face, and amend the test to expect one. |
| 3   | Dark grounds from the approved palette       | **None. Conformed.** Eva Dark `#0A0A0A` is retired              | `#0a0a0a` is named as forbidden, and the palette snapped cleanly, so there was nothing to trade.                                                                                   | Already done. Listed here so the decision is on the record.                              |

Everything else in the house rules is adopted without exception. A future
conflict must be added to this table with the same four columns, or resolved
in favour of the house rule.

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
| Style                | Structured, tokenized, content-first                                |

Goals, in priority order:

1. A reader finds the answer and leaves. Time to answer beats time on page.
2. A contributor adds a page or a section without making a design decision.
3. An agent reads the page as well as a person does. Content must not depend
   on JavaScript, hover, or color alone.
4. The two sites and the terminal program agree. The same accent, the same two
   faces, the same words.

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

- Buttons must default to the quiet variant. At 48 instances a filled button
  is noise. At most one accent button may appear per page, on either surface.
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
  `oklch()` value, or a Tailwind color utility in component code is a defect.
- Semantic names are the vocabulary. The CSS custom properties in
  [packages/ui/src/styles/tokens.css](../packages/ui/src/styles/tokens.css) are the
  implementation. The mapping tables below are the contract between them.
- A new token must be added to `packages/ui/src/styles/tokens.css`, to DESIGN.md, and
  to this file in the same change. A token that exists in two of the three
  places is a defect, and the table in 2.3 is where the three are welded.
- Existing custom properties must not be renamed. The brand package ships to
  two origins, and a rename is churn with no reader-visible result. This is
  why a few semantic names and CSS properties disagree; 2.3 maps them.

- A surface must not define a token in its own stylesheet. If a value is
  needed twice it belongs in the brand package. If it is needed once it is not
  a token.

`bun run design:lint` checks DESIGN.md against the format's own linter and
must report **0 errors and 0 warnings**. Three rules of the format shape what
the front matter can hold, and all three are followed rather than worked
around:

| Rule of the format         | What it means here                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every colour is bound      | A colour no component references is an orphan. Ours are named plainly — `canvas`, `canvas-soft`, `hairline`, `edge`, `ink`, `body`, `mute` — and each is bound to a real component, including the three 1 px rules. |
| One scheme                 | The format has no scheme dimension, so DESIGN.md carries the dark scheme only. The light scheme is normative **here**, in 2.3, and in `tokens.css`.                                                                 |
| Eight component sub-tokens | Only `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width` exist. Borders, gradients and motion are prose, not component tokens.                                            |

A warning is a defect. Do not add a token the format cannot carry and then
explain the warning away; either express it within these three rules or keep
it out of the front matter and document it in prose.

### 2.2 Deviations from the supplied token set

The supplied token set was captured from a rendered page. Four groups of
values are unusable as given. Each deviation is stated with its evidence, and
the resolution is binding.

**Colors: the captured palette interleaves two schemes.** Verified with the
sRGB conversion of the supplied values:

| Supplied pairing                                                      | Contrast   | Verdict                             |
| --------------------------------------------------------------------- | ---------- | ----------------------------------- |
| `text.primary` oklch(0.141 0.005 285.823) on `surface.base` `#000000` | **1.06:1** | Fails; text is invisible            |
| `text.secondary` `#0a0d12` on `surface.base` `#000000`                | **1.08:1** | Fails; text is invisible            |
| `text.tertiary` `#ffffff` on `surface.base` `#000000`                 | 21.0:1     | Passes, but the role is mislabelled |

`text.primary` and `text.secondary` are light scheme inks. `surface.base` and
`text.tertiary` are dark scheme values. `border.muted` is given at 18% alpha
and `border.strong` at 16%, so the muted border is the stronger of the two.
**Resolution:** the semantic names are kept exactly as supplied. The values
bind to the scheme-aware pairs in 2.3, all measured.

**Typeface: `Inter` is on the forbidden list.** It is also unusable here for
the reason in override 1. **Resolution:** `font.family.primary` binds to Space
Grotesk. The supplied fallback chain is kept in full; its CJK and system
entries are correct and conflict with nothing.

**Radius: three of the seven steps are not perceivable.** `lg=9px`, `xl=10px`
and `2xl=11px` sit 1px apart, and none of them is a Tailwind value.
**Resolution:** the whole set is replaced by the Tailwind scale in 2.6.

**Scales: both are off-system.** The supplied `font.size` steps of 11, 13 and
15px are not on the type scale, and `space` steps of 6, 10 and 20px are not on
the spacing scale. **Resolution:** every size snaps to the closest step below
per 2.4, and every gap resolves to the spacing table in 2.5.

### 2.3 Color

Every color token resolves per scheme. A component must read the semantic
token and must never branch on the active scheme. Every dark field is an
approved value; backgrounds are flat.

One color has three names: the semantic name used in this file, the token name
used in DESIGN.md, and the CSS custom property that ships. They are listed
side by side here because that is the only way the three stay welded together.
Where the names differ it is because the CSS properties predate the system and
renaming them is churn with no reader-visible result.

| Semantic token         | DESIGN.md token   | CSS property           | Light     | Dark      |
| ---------------------- | ----------------- | ---------------------- | --------- | --------- |
| `color.text.primary`   | `ink`             | `--eva-text`           | `#0a0a0a` | `#f5f5f5` |
| `color.text.secondary` | `body`            | `--eva-lede`           | `#484848` | `#c4c4c4` |
| `color.text.tertiary`  | `mute`            | `--eva-muted`          | `#717171` | `#989898` |
| `color.text.inverse`   | `canvas`          | `--eva-bg`             | `#fafafa` | `#000000` |
| `color.text.accent`    | `primary`         | `--eva-accent`         | `#3d5fc9` | `#7aa2f7` |
| `color.surface.base`   | `canvas`          | `--eva-bg`             | `#fafafa` | `#000000` |
| `color.surface.raised` | `canvas-soft`     | `--eva-card`           | `#ffffff` | `#181818` |
| `color.surface.strong` | `canvas-panel`    | `--eva-panel-ink`      | `#181818` | `#1F1F1F` |
| `color.border.default` | `hairline`        | `--eva-rule`           | `#e2e2e2` | `#272727` |
| `color.border.strong`  | `hairline-strong` | `--eva-rule-strong`    | `#c4c4c4` | `#313131` |
| `color.border.control` | `edge`            | `--eva-border-control` | `#8A8A8A` | `#6B6B6B` |
| `color.border.muted`   | `grid`            | `--eva-grid`           | `#ededed` | `#181818` |
| `color.mark`           | `mark`            | `--eva-mark`           | `#7aa2f7` | `#7aa2f7` |
| `color.warning`        | `warning`         | `--eva-warning`        | `#b37903` | `#e1ad63` |
| `color.heading.from`   | `heading`         | `--eva-heading-from`   | `#000000` | `#FFFFFF` |
| `color.heading.to`     | `heading-soft`    | `--eva-heading-to`     | `#666666` | `#9B9B9B` |

The DESIGN.md column carries the **dark** value only. That file has no scheme
dimension, so it holds one scheme and this table is where the light column
becomes normative. The CSS property is the same in both schemes; only the
value behind it changes, in the `.dark` block of `tokens.css`.

Two tokens do **not** flip with the scheme, because the field they sit on is
dark in both. Anything drawn on `color.surface.strong` must read these:

| Semantic token          | DESIGN.md token           | CSS property            | Both schemes |
| ----------------------- | ------------------------- | ----------------------- | ------------ |
| `color.on-strong`       | `ink` in the dark scheme  | `--eva-on-strong`       | `#f5f5f5`    |
| `color.on-strong.muted` | `mute` in the dark scheme | `--eva-on-strong-muted` | `#989898`    |

These have no separate name in DESIGN.md because in the dark scheme they are
already `ink` and `mute`. They exist as their own custom
properties so the **light** scheme has something to pin: without them a light
page would flip the panel's ink and fail.

There is deliberately no accent ink for that field. Accent **text** is not
used on `color.surface.strong` at all, which removes the failing case instead
of documenting a way around it. A focus ring inside the panel is unaffected: a
ring is non-text and only has to clear 3:1.

Measured contrast, sRGB, both schemes:

| Pairing                               | Light      | Dark    | AA normal text     |
| ------------------------------------- | ---------- | ------- | ------------------ |
| `text.primary` on `surface.base`      | 18.97:1    | 19.26:1 | Pass               |
| `text.secondary` on `surface.base`    | 8.76:1     | 12.04:1 | Pass               |
| `text.tertiary` on `surface.base`     | 4.68:1     | 7.28:1  | Pass, at the floor |
| `text.tertiary` on `surface.raised`   | 4.88:1     | 6.16:1  | Pass               |
| `text.accent` on `surface.base`       | 5.47:1     | 8.34:1  | Pass               |
| `text.accent` on `surface.raised`     | 5.71:1     | 7.05:1  | Pass               |
| `text.inverse` on primary button      | 18.97:1    | 19.26:1 | Pass               |
| Heading gradient end stop on base     | 5.50:1     | 7.56:1  | Pass               |
| `color.warning` on `surface.base`     | **3.56:1** | 10.36:1 | **Light fails**    |
| Raw `#7aa2f7` on light `surface.base` | **2.41:1** | n/a     | **Fails**          |

`color.surface.strong` is measured separately, because it is the same dark
field on both surfaces and only the page around it changes:

| Pairing                                           | On a light page | On a dark page | AA normal text |
| ------------------------------------------------- | --------------- | -------------- | -------------- |
| `color.on-strong` on `surface.strong`             | 16.29:1         | 15.12:1        | Pass           |
| `color.on-strong.muted` on `surface.strong`       | 6.16:1          | 5.71:1         | Pass           |
| `text.accent` on `surface.strong`, light resolved | **3.11:1**      | n/a            | **Fails**      |

Five binding consequences:

- **The last row is the trap.** A component that follows the usual advice and
  reads the scheme-aware `color.text.accent` gets `#3d5fc9` on a light page,
  paints it on the dark panel, and lands at 3.11:1. Every code block on the
  documentation site would fail AA in light mode. Use `color.on-strong` and
  `color.on-strong.muted` on that field. This is the one place a component
  does not read the scheme-aware pair.
- `color.text.tertiary` is the contrast floor at 4.68:1 on the light ground.
  No token may be added below it.
- `color.warning` must not carry body text in the light scheme. It is a
  border, an icon, and a large text color there.
- `color.mark` is the graphics-only accent. `color.text.accent` is the
  text-safe one. Setting text in `color.mark` on a light ground is a defect.
- The heading gradient is measured at its **end stop**, which is the weakest
  point. Any change to `color.heading.to` must be re-measured.
- A hairline is not a control boundary. `color.border.default` and
  `color.border.strong` measure between 1.19:1 and 1.67:1 against the fields
  they sit on. That is correct for separating two static surfaces and fails
  SC 1.4.11 for anything that needs an outline to be recognised as a control.
  Use `color.border.control`, at 3.94:1 on the dark ground and 3.31:1 on the
  light one.

The boundary rule in one line: **a card may use a hairline, an input may not.**
A card is identified by its content; an input is identified by its edge.

Backgrounds must be flat. The only gradient in the system is the hero heading
text in 3.11. Hover and active fields are derived, not tokenized:

```css
/* Works in both schemes and adds no token. */
background: color-mix(in oklch, var(--eva-text) 6%, transparent); /* hover */
background: color-mix(in oklch, var(--eva-text) 10%, transparent); /* active */
```

A token belongs to one role. Reusing another role's token because it is the
right colour today welds the two together: when that role's colour changes,
this element changes with it and nobody knows why. Add a token for the new
role instead, or read the one that names what this element is.

A gradient states the space it interpolates in. `in oklab` keeps an even
brightness across the ramp; `in oklch` keeps the middle stops vivid; naming
neither falls back to sRGB and its muted midpoint. The heading gradient
interpolates `in oklab`.

Shadows are not used. Depth is a hairline and a tonal step.

### 2.4 Typography

| Token                  | Value                                                                                                                                                                 | Role                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `font.family.primary`  | Space Grotesk                                                                                                                                                         | All UI, body, and code |
| `font.family.display`  | Instrument Serif                                                                                                                                                      | `h1` and `h2` only     |
| `font.family.stack`    | `Space Grotesk, -apple-system, system-ui, Segoe UI, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, Apple SD Gothic Neo, Malgun Gothic, Noto Sans CJK KR, sans-serif` | Fallback chain         |
| `font.size.base`       | 16px                                                                                                                                                                  | Body                   |
| `font.weight.base`     | 400                                                                                                                                                                   | Body                   |
| `font.lineHeight.base` | 24px                                                                                                                                                                  | Body, a 1.5 ratio      |

Every size must land on a type scale step, and must take that step's line
height. A size that does not land on a step snaps to the **closest step
below**. Arbitrary values such as `text-[19px]`, `font-size: 22px`, `1.4rem`
or any `clamp()` are defects.

| Step        | Size | Line height | Used for                                        |
| ----------- | ---- | ----------- | ----------------------------------------------- |
| `text-xs`   | 12px | 16px        | Eyebrow, stage tag, caption                     |
| `text-sm`   | 14px | 20px        | Code, header buttons, sidebar leaf, TOC, labels |
| `text-base` | 16px | 24px        | Body, main buttons, card title                  |
| `text-lg`   | 18px | 28px        | Lede, `h3`                                      |
| `text-xl`   | 20px | 28px        | Not used                                        |
| `text-2xl`  | 24px | 32px        | Not used                                        |
| `text-3xl`  | 30px | 36px        | `display-3`, documentation `h2`                 |
| `text-4xl`  | 36px | 40px        | Tagline reveal, mobile hero                     |
| `text-5xl`  | 48px | 1           | `display-2`, documentation `h1`, tagline        |
| `text-6xl`  | 60px | 1           | `display-1`, marketing section `h2`             |
| `text-7xl`  | 72px | 1           | `display-hero`, marketing hero `h1`             |

Fluid sizing is done with responsive steps, never with a clamp. A hero reads
`text-4xl md:text-6xl lg:text-7xl`.

The four display steps ship as tokens, because both surfaces need them: the
marketing site through the `.d-*` classes, the documentation site to bind its
own `h1` and `h2` to the same scale. Size and tracking travel together, since
the display face has one weight and the step is all the hierarchy there is.

| Step         | Size | Tracking | CSS property                                 | Class     |
| ------------ | ---- | -------- | -------------------------------------------- | --------- |
| `display-xl` | 72px | -0.028em | `--text-display-xl`, `--tracking-display-xl` | `.d-hero` |
| `display-lg` | 60px | -0.024em | `--text-display-lg`, `--tracking-display-lg` | `.d-1`    |
| `display-md` | 48px | -0.02em  | `--text-display-md`, `--tracking-display-md` | `.d-2`    |
| `display-sm` | 30px | -0.015em | `--text-display-sm`, `--tracking-display-sm` | `.d-3`    |

Each class opens at the step its content takes below 768px and climbs at 768px
and 1024px. The line height travels with the size as `--text-display-*--line-height`.

Headings below `h2` use the primary face, on both surfaces:

| Element      | Step        | Face    | Weight | Tracking |
| ------------ | ----------- | ------- | ------ | -------- |
| `h3`         | `text-lg`   | Primary | 600    | -0.005em |
| `h4` to `h6` | `text-base` | Primary | 600    | -0.005em |

Rules:

- Never set type in italic, anywhere, on either surface. Emphasis is color,
  size or weight.
- Never use a weight above 600. There is no black or extra bold.
- The display face ships one weight. Hierarchy must come from size, leading
  and tracking. A second weight on `h1` or `h2` is a defect.
- Tracking may only be adjusted within the line height the matched step
  provides. Do not set a custom line height beside a snapped size.
- No hyphen may appear inside a sentence, a heading or a label. Rewrite the
  phrase. This governs copy rendered on either site. It does not govern this
  file, code identifiers, CSS property names, or command syntax. One exemption
  is on the record: `AI-native`, in the product tagline and wherever the
  product is described. The hyphen carries the compound there, and dropping it
  leaves three stacked nouns that read as a different claim. Recorded in
  [decisions.md](decisions.md); no second exemption without one.
- No word may sit alone on the last line. Headings set `text-wrap: balance`;
  body copy sets `text-wrap: pretty`.
- Headings are sentence case, not title case.
- Code must set tabular figures and a slashed zero, and is one token, so the
  same command is one size on both sites. That size is `text-sm`, one step
  above the caption row: this system sets code in a proportional face, which
  already costs it legibility, and at `text-xs` on the dark panel that cost
  came due. 14px is the smallest step that reads as code.
- Body measure must not exceed 680px. A block that breaks out must opt in
  explicitly and must re-measure.
- Tabular figures go on **every value that changes** and in every table, not
  only in a data-dense view: a timer, a counter, a price, a star count, a
  version. A digit that changes width makes the row jump.
- Copy is stored in its natural case and presented with `text-transform`. An
  eyebrow is written as a sentence and uppercased by CSS, so the text a screen
  reader announces and the text a search engine indexes are the real words.
- Punctuation is typographic: curly quotes, an en dash for a range, an em dash
  for an aside, and the single ellipsis character. Never a straight quote, and
  never three periods.
- Underlines set `text-underline-position: from-font` and
  `text-decoration-skip-ink: auto`, so a rule is drawn where the face says and
  clears the descenders rather than striking through them.
- A long word breaks rather than escaping its column: `overflow-wrap:
break-word` on prose, and `white-space: nowrap` on a label or a badge that
  must stay on one line.
- Font smoothing is declared once, on the root, and never per component.
- `text-wrap` has three answers, not two. `balance` on headings, `pretty` on a
  description or short copy, and **neither in long-form**: across a page of
  documentation the browser reflows several lines at every paragraph to save
  one orphan, which costs more than it buys.
- Truncated text must keep its full value reachable, in a tooltip or an
  expanded view. Text that is only ever truncated is text that was never
  shown.

### 2.5 Spacing

Only these values. Nothing between them, nothing outside them.

| Token         | Value | Token         | Value |
| ------------- | ----- | ------------- | ----- |
| `spacing.0`   | 0     | `spacing.400` | 32px  |
| `spacing.25`  | 2px   | `spacing.500` | 40px  |
| `spacing.50`  | 4px   | `spacing.600` | 48px  |
| `spacing.75`  | 8px   | `spacing.700` | 64px  |
| `spacing.100` | 12px  | `spacing.800` | 80px  |
| `spacing.200` | 16px  | `spacing.900` | 96px  |
| `spacing.300` | 24px  |               |       |

Buttons take 8px of vertical padding and 12px of horizontal padding.

Page-level values:

| Value           | Size   | CSS property          | Note                                |
| --------------- | ------ | --------------------- | ----------------------------------- |
| Container       | 1200px | `--container-page`    | Centred, with a gutter either side  |
| Measure         | 680px  | `--container-measure` | Hero heading, subheading, and prose |
| Gutter          | 24px   | `--eva-gutter`        | The container's side padding        |
| Grid cell       | 48px   | `--eva-grid-cell`     | The measurement grid                |
| `section-tight` | 48px   | `.section-y-tight`    | A run of short related blocks       |
| `section`       | 64px   | `.section-y`          | The default band                    |
| `section-lg`    | 96px   | `.section-y-lg`       | A band that must stand alone        |

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

**Padding on a pill is not padding on a rectangle.** The end caps curve away,
so a control set 8px from the widest point of a 52px pill sits about 1px from
the edge at its own top corner. Measure the clearance at the corner, not at
the centre line.

Use logical properties — `padding-inline`, `margin-block-start`,
`inset-inline-end` — rather than left and right. They are the same length in
this system today and the correct one the day a surface is not left to right.

A text container must not carry a fixed width or height. Cap it with
`max-width` and let the content decide the rest.

Every gap must be a token. A one-off value such as `margin-top: 13px` is a
defect even when it looks correct. Vertical padding should be adjusted
optically; the bottom of a band usually needs one step more than the top.

### 2.6 Radius

Tailwind values only.

| Token          | Value  | Use                                     |
| -------------- | ------ | --------------------------------------- |
| `rounded-none` | 0px    | Rules, dividers, the measurement grid   |
| `rounded-xs`   | 2px    | The floor for a nested result           |
| `rounded-sm`   | 4px    | Badge, inline code                      |
| `rounded-md`   | 6px    | Input, small control                    |
| `rounded-lg`   | 8px    | Button, popover, callout                |
| `rounded-xl`   | 12px   | Card, code block, terminal panel        |
| `rounded-2xl`  | 16px   | A full-bleed feature panel              |
| `rounded-full` | 9999px | The navigation island and the stage tag |

**Nested radius.** When a shape sits inside another and the gap between them
is under 32px:

```
inner radius = outer radius − gap
```

Apply only when the result is above 2. Below that the inner shape stays
square. A card at `rounded-xl` with 8px of padding gives an inner element 4px,
which is `rounded-sm`.

**Decision D1 — one button shape.** Buttons use `rounded-lg` on both surfaces.
The pill is retained for the navigation island and the stage tag only. Two
button shapes across two surfaces of one brand is the drift these rules exist
to prevent. This changes the marketing site; see 7.2.

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
mattered is buried among them. `transition-property` is a list, and writing it
is the whole cost.

Tailwind's own transition utilities fall back to a default duration and a
default curve. `tokens.css` re-points `--default-transition-duration` and
`--default-transition-timing-function` at the table above, so a bare
`transition-colors` lands on the system rather than off it. A micro
interaction may run at `instant`, but never below 150ms.

**Scroll reveal.** An element entering the viewport moves from
`translate-y-16 blur-md opacity-0` to `translate-y-0 blur-0 opacity-100` over
`duration-reveal` or longer. Siblings stagger by `--stagger`.

Rules:

- Reveals must use `IntersectionObserver`, or `whileInView` where a motion
  library is already present. `window.addEventListener('scroll')` is a defect;
  it causes continuous reflow and destroys mobile performance.
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
  to; an animation restarts. Anything a reader can reverse by moving the
  pointer is a transition.
- **Suppress every transition while the scheme changes.** Flipping light to
  dark repaints every colour at once, and each element that carries a colour
  transition animates that repaint, so the page wipes through an intermediate
  palette. `applyTheme` sets `data-theme-changing` on the root for one frame.
- **Do not animate a high-frequency interaction.** The colour of a row in a
  list on hover, a value that ticks: animating these makes a list feel wet and
  costs a paint per frame per row.
- `will-change` names only `transform`, `opacity` or `filter`, and only while
  the property is actually about to change. Left on, it holds a layer for an
  element that is doing nothing. The one standing exception is an element that
  shifts by a pixel or two mid-animation in Safari on iOS, which
  `will-change: transform` settles.
- **Cross-fade an icon that swaps.** The entering icon runs scale 0.25 to 1,
  opacity 0 to 1 and blur 4px to 0; the leaving one runs the same in reverse.
  An icon that is replaced in one frame reads as a glitch. A control whose two
  states are one shape moving — the menu button — morphs instead, which is
  better still.

### 2.8 Focus

One focus treatment, both surfaces, every component:

```css
:focus-visible {
  outline: 2px solid var(--eva-accent);
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
- The ring measures 5.47:1 light and 8.34:1 dark against `surface.base`, above
  the 3:1 that SC 1.4.11 requires.

It is authored once, in `packages/ui/src/styles/tokens.css`, and deliberately left
outside `@layer base` so a component cannot quietly outrank it.

### 2.9 Icons

- Icons must come from **Phosphor**, **Solar** or **Iconamoon**.
- Lucide, Feather, Material Icons and Material Symbols are defects. They are
  the default choices and they read as one.
- Every icon must use one stroke weight across the whole system.
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

**Radii are concentric.** A shape inside another follows
`inner = outer − gap`, so the two curves stay parallel. The formula is in 2.6.
It applies to a pill as well: a pill's effective radius is half its height, so
a control inside one wants a radius near half of its own height, or the shapes
fight.

**An image carries its own edge.** A screenshot has no boundary of its own, so
a light one on a light ground floats and a dark one on a dark ground merges
into it. Give it a 1px outline offset by `-1px` — black at 8% in light,
white at 8% in dark — which draws inside the box and never grows it. This is
an outline, not a shadow, and it is the only edge an image gets.

## 3. Component rules

Each component is marked **shared**, **marketing**, or **docs**. A shared
component must render identically on both surfaces.

### 3.1 The shared state model

Every interactive element must define all seven states. A component shipped
without them is incomplete.

| State         | Requirement                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Default       | Resting. No elevation, no shadow.                                                                                                         |
| Hover         | Background shift, slight scale, or translate. Pointer only; never the sole carrier of information.                                        |
| Focus-visible | The ring from 2.8. Must be reachable by keyboard alone.                                                                                   |
| Active        | `scale(0.98)` or `translateY(1px)` for physical feedback. Must be distinct from hover.                                                    |
| Disabled      | 45% opacity, `aria-disabled="true"`, pointer events off. Must stay focusable so a screen reader can find it and read why.                 |
| Loading       | A skeleton shaped like the real layout, never a circular spinner. `aria-busy="true"`. Width must not change.                              |
| Error         | Inline and specific, tied by `aria-describedby`, with `aria-invalid="true"`. Never `window.alert()`. Color must never be the only signal. |

**A control whose label changes reserves the width of its widest label.**
This is the loading rule generalised, and it is not only about loading: a
theme control cycling "System" to "Dark", a copy button going to "Copied", a
count ticking from 9 to 10. The control resizes, and everything laid out
around it moves — a centred navigation island pulls both of its edges inward,
and a button beside a code block reflows the command under the pointer.

Render every option into one grid cell and hide all but the current one with
`visibility: hidden`, which holds the box. Then set the accessible name
explicitly with `aria-label`, because the hidden options are still in the
markup and name-from-content is only as reliable as each engine's handling of
hidden text. The visible word must appear inside that name, per SC 2.5.3.

Empty states are a composed "getting started" view, never a blank panel.

Disabled must use `aria-disabled`, not the `disabled` attribute, on anything a
reader might need to find. The `disabled` attribute removes the control from
the tab order and the explanation goes with it.

No dead links. A button pointing at `#` is either linked or visually disabled.
The current page must be indicated in the navigation.

### 3.2 Button — shared

**Anatomy.** Optional leading icon, label, optional trailing icon. Gap 4px.
Padding 8px vertical, 12px horizontal. Radius `rounded-lg`.

| Variant   | Type        | Field                  | Text                   | Border                 | Budget per page |
| --------- | ----------- | ---------------------- | ---------------------- | ---------------------- | --------------- |
| Quiet     | `text-base` | Transparent            | `color.text.secondary` | None                   | Unlimited       |
| Outline   | `text-base` | `color.surface.raised` | `color.text.primary`   | `color.border.default` | Unlimited       |
| Primary   | `text-base` | `color.text.primary`   | `color.text.inverse`   | None                   | One per view    |
| Accent    | `text-base` | `color.text.accent`    | `color.text.inverse`   | None                   | One per page    |
| Header    | `text-sm`   | Transparent            | `color.text.secondary` | None                   | Unlimited       |
| Icon-only | n/a         | Transparent            | `color.text.tertiary`  | None                   | Unlimited       |

All button type is weight 600.

A filled button that sits in a row of chrome takes the header step instead of
the body one, and changes nothing else. The navigation island is a band of
controls, and an accent CTA at `text-base` makes the island a third taller
than the row it belongs to. It is a size, not a variant.

| State         | Quiet, header, icon-only   | Outline                   | Primary and accent |
| ------------- | -------------------------- | ------------------------- | ------------------ |
| Hover         | 6% wash, text to `primary` | Border to `border.strong` | 8% lighten         |
| Focus-visible | Ring                       | Ring                      | Ring               |
| Active        | `scale(0.98)`              | `scale(0.98)`             | `scale(0.98)`      |
| Disabled      | 45% opacity                | 45% opacity               | 45% opacity        |
| Loading       | Skeleton at resting width  | Same                      | Same               |
| Error         | The form owns the error    | Same                      | Same               |

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

**Anatomy.** Text, optional trailing external-link icon at `text-xs`.

| Variant      | Surface   | Treatment                                                                                       |
| ------------ | --------- | ----------------------------------------------------------------------------------------------- |
| Inline prose | Both      | `color.text.accent`, 1px underline, no weight change                                            |
| Navigation   | Both      | `color.text.secondary`, underline on hover                                                      |
| Rule link    | Marketing | Underline grows from 0% to 100% width on hover                                                  |
| Sidebar leaf | Docs      | `text-xs`, `color.text.tertiary`; current page in `color.text.primary` with an accent left rule |
| TOC          | Docs      | `text-sm`, `color.text.tertiary`; active heading in `color.text.accent`                         |
| External     | Both      | Inline treatment, plus icon and `rel="noreferrer"`                                              |

**States.** Hover underlines or grows the rule to full width. Focus-visible
paints the ring. Active drops to 80% opacity. Disabled is not a link; render
text. Loading is a prefetch in flight and must produce no visual change. Error
means the target 404s, which the router must resolve to the custom 404 page.

**Interaction.** Links must be `<a href>`. A `div` with a click handler is a
defect. `Enter` activates; `Space` must not. Middle-click and modifier-click
must open a new tab, which rules out `preventDefault` on plain navigation.

**Responsive and edge cases.**

- The underline must never be the only difference from body text. Color plus
  underline is the minimum; SC 1.4.1 forbids color alone.
- A long URL used as link text must wrap with `overflow-wrap: anywhere`.
- At 31 links per page, weight must stay 400. Bold links are a defect.
- The current sidebar item must carry `aria-current="page"`.

### 3.4 List — shared

**Anatomy.** Marker, content, optional nested list. Item gap 8px. Nested
indent 16px.

**Variants.** Unordered with a `color.text.tertiary` marker; ordered with
tabular figures so numbers align; definition lists for option and flag
reference; task lists with a non-interactive checkbox.

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
- Ordered lists must not restart across a page break in print.

### 3.5 Card — shared

**Anatomy.** Optional icon, title `text-base`, description `text-base` in
`color.text.secondary`, optional footer. Padding 24px. Inner gap 12px. Radius
`rounded-xl`. Border 1px `color.border.default` on all four sides. Field
`color.surface.raised`.

A single-sided border is never a card edge. Borders go all the way around or
not at all.

**Variants.** Static; link card, where the whole card is one target; and
terminal card, which uses `color.surface.strong` and stays dark in both
schemes.

**States.** Hover moves the border to `color.border.strong`. Focus-visible
paints the ring around the card, not the title. Active applies
`scale(0.98)`. Loading shows a skeleton at the resting height. Error replaces
the body with a message and a retry button, and keeps the card frame.

Cards must have no shadow, and a card should exist only where a tonal step
communicates hierarchy. A border plus a shadow plus a white field is the
generic card look and is a defect.

**Interaction.** A link card must contain exactly one focusable element. Use a
stretched pseudo-element from the title link, not a nested set of tab stops.

**Responsive and edge cases.**

- A three equal column feature row is the most generic layout there is. Three
  to five benefits is correct as content; the layout should be a two column
  zig zag, an asymmetric grid, or masonry.
- Cards in a grid must allow variable height, not truncate text to match.
- A title of more than two lines must wrap, not clamp. A clamped title hides
  the distinguishing word.
- Below 768px a card grid collapses to one column and hover effects are
  dropped; there is no hover on touch.
- An empty card grid must render the empty state, not a lone border.

### 3.6 Navigation — per surface

**Marketing: the island.** The navigation is a detached pill, not a docked
bar: `mt-6 mx-auto w-max rounded-full` on `color.surface.raised` with a 1px
`color.border.default` edge. It holds the wordmark, section links, the theme
control, and one accent CTA.

- The hamburger lines must rotate and translate into a true X with `rotate-45`
  and `-rotate-45`. They must never simply disappear or swap glyph.
- The menu opens as a screen-filling overlay with `backdrop-blur-3xl` over
  `bg-black/80` or `bg-white/80`, not as a dropdown.
- Links inside the overlay stagger in from `translate-y-12 opacity-0` to
  `translate-y-0 opacity-100`, one `--stagger` step apart.
- The island must not obscure a focused element. See check B4.

**Documentation.** Three regions, each a distinct landmark with its own name:

| Region       | Element                                   | Name          | Contents                                     |
| ------------ | ----------------------------------------- | ------------- | -------------------------------------------- |
| Top bar      | `<header>` with `<nav aria-label="Main">` | Main          | Wordmark, tab row, search, repository, theme |
| Sidebar      | `<nav aria-label="Documentation">`        | Documentation | Page tree, collapsible groups                |
| On this page | `<nav aria-label="On this page">`         | On this page  | Heading TOC                                  |

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
- The theme control must reflect the resolved scheme and must not flash on
  load. The pre-paint script in
  [packages/ui/src/theme.ts](../packages/ui/src/theme.ts) owns this, and
  the cookie is shared across both origins. It must offer all three states —
  light, dark, and follow the system — and it must name the state it is in. A
  sun and moon switch is a defect: it carries two states where there are
  three, and it says which one is on with a picture. A labelled button that
  cycles the three, a dropdown, or a settings entry all qualify. A native
  `<select>` does not: it brings the platform's own control chrome and its own
  focus ring, neither of which this system can style.

### 3.7 Code block and command snippet — shared

**Anatomy.** Optional filename or channel bar, the code, and a copy button in
the top right. `text-xs`. Radius `rounded-xl`. Field `color.surface.strong`,
so code is dark in both schemes and matches the terminal.

**States.** The copy button is quiet and must be visible without hover.
Focus-visible paints the ring. On success the label changes to "Copied" and
announces through an `aria-live="polite"` region. Error announces "Copy
failed" and reveals a selectable fallback.

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
`role="tabpanel"`. Labels at `text-xs`, uppercase, tracking 0.04em.

**States.** The selected tab carries `aria-selected="true"` and
`color.text.primary`; the rest are `color.text.tertiary`. Hover moves an
unselected tab to `color.text.primary`. Focus-visible paints the ring. Loading
and error belong to the panel, not the tab.

**Interaction.**

- Arrow keys must move between tabs; `Home` and `End` jump to the ends.
- Only the selected tab is in the tab order. `Tab` from the tablist moves into
  the panel.
- Each tab must control its panel through `aria-controls`.
- The selected state must be carried by more than color. An underline or a
  field change is required.

**Edge cases.** With one channel, render no tablist. A channel whose content
fails to load must show the error inside the panel and keep the tabs usable.

### 3.9 Disclosure — shared

Used by the marketing FAQ and by collapsible groups in the documentation
sidebar.

**Anatomy.** A `<details>` element with a `<summary>` trigger and a chevron.
Summary at `text-base`, weight 500. A 1px divider between items. A divider
between rows is not a card border and is permitted.

**States.** Closed by default. Hover moves the summary to `color.text.accent`.
Focus-visible paints the ring on the summary. Open rotates the chevron over
`--dur-fast` on `--ease-fluid`.

**Interaction.** `Enter` and `Space` must toggle. The native element provides
this; a custom re-implementation is a defect.

**Edge cases.**

- The open state must be visible without color. A chevron or a plus-minus mark
  is required; a color change alone fails SC 1.4.1.
- `list-style: none` on the summary removes the native marker, so a chevron
  must be supplied in the same change.
- Content inside a closed disclosure must remain in the document, so search
  and agents can read it.
- A stack of chevrons is the generic FAQ pattern. A side by side list or
  inline progressive disclosure should be preferred where the content allows.
- A disclosure must not hold information a reader needs in order to act.

### 3.10 Callout — docs

**Anatomy.** Icon, optional title `text-base`, body `text-base`. Padding 16px.
Radius `rounded-lg`. A 1px border on all four sides in the variant color.

| Variant | Border and icon       | Body text            |
| ------- | --------------------- | -------------------- |
| Note    | `color.border.strong` | `color.text.primary` |
| Tip     | `color.text.accent`   | `color.text.primary` |
| Warning | `color.warning`       | `color.text.primary` |

Body text must be `color.text.primary` in every variant. `color.warning`
measures 3.56:1 in light and fails AA for body copy; the border and icon carry
the signal.

**States.** Static. A dismissible callout must keep a focusable close button
and must not hold content a reader needs twice.

**Edge cases.** A callout must not nest, and must not be the only place a
constraint appears; a reader scanning headings will miss it.

### 3.11 Hero — marketing

**Anatomy.** Eyebrow, `h1`, subheading, one primary CTA, one proof signal, and
a product visual.

- The `h1` is the one gradient in the system: left to right on the text,
  `color.heading.from` to `color.heading.to` for the active scheme. Never on a
  background.
- The `h1` and the subheading both cap at 680px.
- Line breaks in the `h1` are placed by hand, where the thought breaks. A
  break that splits a phrase awkwardly is a defect.
- Type is `text-4xl md:text-6xl lg:text-7xl`.
- One primary action. A competing CTA above the fold is a defect.

### 3.12 Tagline reveal — marketing, mandatory

Every marketing page carries one large-type band stating the core benefit,
separate from the hero and further down the page. It is its own moment, never
stacked directly under the hero.

- **Copy.** Minimum two lines. A benefit statement in the product voice, not a
  generic section heading.
- **Type.** `text-4xl` to `text-6xl` depending on line count, capped at 680px
  with meaningful line breaks.
- **Animation.** Words start at 30% opacity of `color.text.primary` and reach
  full color one at a time, in reading order, as each crosses the trigger
  line. The block must not flip at once. The transition uses
  `--ease-fluid`, never a linear fade.
- **Implementation.** One `IntersectionObserver` per word, or a single scroll
  handler throttled through `requestAnimationFrame`. An unthrottled scroll
  listener is a defect.
- Under `prefers-reduced-motion: reduce` every word renders at full color
  immediately.

### 3.13 Section, eyebrow and stage tag — marketing

**Section.** A band with one of the three beats from 2.5, an optional
measurement-grid ground, and a 1200px container with a 24px gutter. A section
must carry exactly one `h2`. Everything centred and symmetrical is the generic
layout; break symmetry with offset margins, mixed aspect ratios, or a left
aligned header over centred content.

**Eyebrow.** An 8px filled `color.mark` square, then a caption at `text-xs`,
uppercase, tracking 0.12em, `color.text.tertiary`. It is a label, not a
heading, and must not be marked up as one.

**Stage tag.** A pill outline at `text-xs`, tracking 0.04em, in
`color.text.tertiary`. When the capability is shipping, the border and text
take `color.text.accent`. The text names the stage; color never carries it
alone.

Every capability that has not shipped must carry a stage tag. A screenshot of
an unshipped capability is not evidence.

## 4. Accessibility requirements and acceptance criteria

Target: WCAG 2.2 AA, both surfaces. Each row is a pass/fail check that a
reviewer or a test can run.

### 4.1 Perceivable

| ID  | Criterion                | Check                                                               | Pass                                                          |
| --- | ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| A1  | 1.4.3 Contrast           | Measure every text-and-field pair in both schemes                   | ≥ 4.5:1 normal, ≥ 3:1 at 18.66px bold or 24px                 |
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
| B4  | 2.4.11 Focus not obscured | `Tab` with the navigation island present     | No focused element is fully hidden behind it           |
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
- Every check above must pass in both schemes. Testing one is testing half.

### 4.5 Control and input rules

- A hit area is at least 24×24 CSS px, should be 40×40 on desktop and 44×44 on
  touch. An extended hit area must never overlap another one; two controls
  whose padding collides give the reader a coin toss.
- Hover styling lives behind `@media (hover: hover)`. On touch `:hover` sticks
  after a tap, so the last thing a reader touched keeps looking selected. The
  `hover:` variant is redefined in `tokens.css` so every call site is gated.
- A decorative element — a glow, a grid, a gradient wash — sets
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
- Cookie consent where the jurisdiction requires it
- A branded favicon
- `<title>`, meta description, `og:image`, and social sharing tags
- Alt text on every meaningful image
- Ad-only and time-bound offers set to `noindex`; evergreen pages given a real
  title, meta description, internal links, and a plain question and answer FAQ

## 6. Anti-patterns and prohibited implementations

Each of these is a defect, not a preference.

**Tokens**

- A raw hex, `oklch()` or Tailwind color utility in component code.
- A one-off spacing, size or radius value that is not in a scale.
- A token defined in a surface stylesheet rather than the brand package.
- A component that branches on the active color scheme.

**Color and surfaces**

- A background gradient of any kind: linear, radial or mesh. The only gradient
  is hero heading text.
- The purple and blue "AI gradient" aesthetic.
- A dark field outside the approved palette, including `#0a0a0a` and `#121212`.
- Text in `color.mark` on a light ground; it measures 2.41:1.
- Body copy in `color.warning` in the light scheme; it measures 3.56:1.
- Color as the only carrier of state, status, selection or link identity.
- A second accent color introduced to rank two kinds of importance.
- A `box-shadow` used for depth, or an untinted black shadow.
- A random dark section inside a light page, or the reverse.

**Type**

- `text-wrap: pretty` or `balance` in long-form text.
- A straight quote, three periods for an ellipsis, or a hyphen used as a dash.
- Copy stored in the case it is displayed in rather than its natural case.
- Font smoothing set per component instead of once on the root.
- A third typeface, or any font loaded from a third-party origin.
- Italic type anywhere.
- A weight above 600.
- A `clamp()` or an arbitrary size such as `text-[19px]` or `1.4rem`.
- A custom line height set beside a snapped size.
- A hyphen inside a sentence, heading or label.
- A word left alone on the last line.
- Title Case On Every Header.
- Inline code and code blocks at different sizes.
- Body copy wider than 680px.

**Layout**

- Equal gaps inside and between groups.
- A fixed width or height on a text container.
- `left` and `right` where a logical property exists.
- A single-sided border on a card.
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
- A tooltip as the only source of a control's name.
- A control that resizes when its own label changes.
- A theme control with two states, or one that names its state with a picture.
- A target below 24×24 CSS pixels, or a hover-only affordance.
- A circular spinner where a skeleton belongs, or `window.alert()` for an error.
- A dead link pointing at `#`.

**Motion**

- `transition: all`, or any transition that does not name its properties.
- A default transition, a literal duration, or a literal easing.
- `window.addEventListener('scroll')` for a reveal.
- Animating `top`, `left`, `width` or `height`.
- Entrance motion on a documentation page.
- A hidden start state that JavaScript cannot undo.
- An animation library shipped to the browser.
- Animating the page through a scheme change.
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

Items 1 to 28 have landed. What is left is listed below, with the reason each
one is still open. When this section is empty, delete it and the plan in
[adoption.md](adoption.md) with it.

### 7.1 Still open

| #   | Gap                                                                                                                                                                                          | Change                                                                                                    | Rule          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| 9   | Neither app imports an icon set; the icons it owns are inline SVG at one stroke weight. Fumadocs ships `lucide-react` inside its own layout, and those icons reach the documentation page.   | Replace the Fumadocs slots that render an icon, or accept the dependency and record it in the table in 0. | 2.9           |
| 10  | There is no terms page. The 404s, the legal link, the privacy page, and the cookie decision have landed.                                                                                     | Write it, or decide a site with no account and no payment does not need one, and record that.             | 5.6           |
| 28  | The sidebar, the table of contents, and the article carry their landmark names. The top bar is a Fumadocs `<header>` with no inner `<nav>`, so it is a banner rather than a named Main.      | Supply the layout's `header` slot, which means reimplementing the navbar, or accept the banner.           | 3.6, check C5 |
| 29  | The documentation theme control offers all three states but names them with a sun, a moon and a monitor. It is Fumadocs' `ThemeSwitch`, and 3.6 says a control must name the state it is in. | Supply `slots.themeSwitch` with a labelled control, or accept the icons and record it in the table in 0.  | 3.6           |

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

Run before merge. Every box must be checked in both light and dark, on the
surface being changed.

**Tokens**

- [ ] No raw color, size, spacing or radius value in the diff
- [ ] Every new token exists in `packages/ui/src/styles/tokens.css` and in this file
- [ ] No token defined in a surface stylesheet
- [ ] Every dark field is an approved value
- [ ] No literal duration or easing; `brand.test.ts` passes

**Type and layout**

- [ ] Two typefaces only, both self-hosted; no italic anywhere
- [ ] No weight above 600
- [ ] Every size lands on a type scale step with that step's line height
- [ ] No `clamp()` and no arbitrary size in the diff
- [ ] `text-wrap: balance` on headings, `pretty` on body; no orphaned words
- [ ] No hyphen inside a sentence, heading or label
- [ ] Inline code and code blocks both at `text-xs`
- [ ] One `h1`; no skipped heading levels; sentence case
- [ ] Container 1200px, prose and hero capped at 680px
- [ ] Nested radii follow the formula
- [ ] No background gradient, no shadow, no single-sided card border
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
- [ ] No entrance motion on a documentation page
- [ ] All transform motion removed under `prefers-reduced-motion: reduce`

**Accessibility**

- [ ] Checks A1 to A8 pass
- [ ] Checks B1 to B9 pass
- [ ] Checks C1 to C8 pass
- [ ] Contrast measured, not estimated, for every new pairing
- [ ] Every changed component **looked at**, in both schemes, not only measured.
      A contrast number is blind to a field painted on the wrong element: the
      code block measured 7:1 while the dark band sat inside a white card and
      ran past its edge.
- [ ] Complete the page's main task with the mouse unplugged
- [ ] Ring visible on every tab stop, never hidden by the navigation island
- [ ] Skip link is the first focusable element

**Craft**

- [ ] No `transition: all`; every transition names its properties
- [ ] Gaps between groups are at least twice the gaps inside them
- [ ] Hover is behind `@media (hover: hover)`; decorative layers are click-through
- [ ] Tabular figures on every changing value and in every table
- [ ] Smart punctuation; copy stored in natural case
- [ ] Images carry the inset hairline; radii are concentric
- [ ] Theme change does not animate

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
- [ ] The theme cookie still resolves across both origins
- [ ] Nothing in the diff contradicts section 7
- [ ] Full content readable with JavaScript disabled
- [ ] Theme resolves before paint; no flash
