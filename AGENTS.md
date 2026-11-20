# AI Agent Context

## Project

`vinhmdev-tools` — developer utility toolkit by VinhMDev (Lê Minh Vinh), an Astro + Preact site at
`https://tools.vinhmdev.com`. Scripts: `npm run dev | build | typecheck | test`.

The user values clean, maintainable, type-safe code and expects technical rationale with each proposal.

When generating code or proposing changes:
1. Prioritize standard libraries and standard patterns over novel but unproven approaches.
2. Type everything (TypeScript), and keep `npm run typecheck` clean.
3. Keep code modular: split a large change into decoupled files rather than one big file.

## Project Structure
- `src/pages/`: Astro routes (`index.astro` + one folder per tool)
- `src/features/`: one module per tool
- `src/shared/`: cross-tool code (components, layouts, i18n, firebase)
