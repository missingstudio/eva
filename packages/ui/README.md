# @missingstudio/ui

The front-end system the sites and the web app stand on: the design tokens —
the two self-hosted faces, the dark-only palette, the surfaces, the motion
contract — the shadcn components, and the shared marks and favicons both sites
point their `publicDir` at.

Everything a site is built _from_ rather than drawn with —
the origins, the vocabulary, the documents an agent reads — is
[`@missingstudio/machine`](../machine/README.md).

## Usage

```css
@import "@missingstudio/ui/tokens.css";
```

```ts
import { Button } from "@missingstudio/ui/components/button"
```
