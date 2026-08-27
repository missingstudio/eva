# Eva

`Eva` is an open-source, autonomous software factory.
The workers of this factory are harnesses.

## Agent skills

### Issue tracker

Issues and specs are markdown files under `plans/<stage>/`, indexed by each
stage's `README.md` plan table. `plans/` is gitignored, so nothing there is a
primary source. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, kept at their default strings, recorded as a
`Status:` line in a ticket file. Only inbound issues are triaged. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context, at this repo's own paths: the glossary is `docs/context.md`,
never a root `CONTEXT.md`, and decision records go in `docs/adr/`. See
`docs/agents/domain.md`.

## Planning and communication

- Use ASD-STE100 Simplified Technical English in commits, plans and documentation.
- Make the smallest correct change. Follow the established package boundaries and command patterns.

## Commit Messages

- Conventional Commits format `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `build`
- Scope optional, use package name when relevant (e.g., `kernel`, `sdk`)
- Lowercase, no period. The description is a sentence that says what is true
  after the change.
- Example: `fix(kernel): a plugin loads whole, or not at all`
- One logical change per commit. Work spanning several gets several commits.

## Branch Naming

- Format: `type/kebab-case-description`
- Example: `feat/tool-calling`, `fix/streaming-first-char-missing`
