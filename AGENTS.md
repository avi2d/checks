# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- `dist/` is committed because bun skips `prepare` on `file:` installs; rebuild with `bun run build`. See README.md "Why it is shaped this way".
- Consumer `.oxlintrc.json` must restate `plugins`: oxlint does not inherit them through `extends`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
