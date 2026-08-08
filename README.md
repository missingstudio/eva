<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/eva-banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/eva-banner-light.png">
    <img alt="Eva — an autonomous, multi-tenant, AI-native software factory" src="docs/assets/eva-banner-dark.png" width="100%">
  </picture>
</p>

# Eva

An autonomous, multi-tenant, AI-native software factory. It builds, tests, improves, and maintains software with minimal human intervention.

**Status:** stage 0 in progress. The workspace, the layer boundaries, and CI are in; no behaviour yet.

## Documents

- [docs/Product.md](docs/Product.md) — the plan: twenty stages, a failable exit test each. Draft.
- [CONTEXT.md](CONTEXT.md) — the glossary. One concept, one name.
- [docs/adr/](docs/adr/) — decisions and their reasons. `0001`–`0008` settle the stage 0 event schema; `0009` fixes config as TOML; `0010` fixes the module layout.
- [AGENTS.md](AGENTS.md) — how to work in this repo. `CLAUDE.md` points at it.