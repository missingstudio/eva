# Eva

`Eva` is an open-source, AI-native software factory.
The workers of this factory are harnesses.

## Planning and communication

- Use ASD-STE100 Simplified Technical English in commits, plans and documentation.
- Make the smallest correct change. Follow the established package boundaries and command patterns.

## Commit Messages

- Conventional Commits format `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `build`
- Scope optional, use package name when relevant (e.g., `expo-example`, `llama`)
- Lowercase, no period, imperative mood
- Example: `feat(expo-example): add maxSteps setting for tool iterations`
- One logical change per commit. Work spanning several gets several commits.

## Branch Naming

- Format: `type/kebab-case-description`
- Example: `feat/tool-calling`, `fix/streaming-first-char-missing`
