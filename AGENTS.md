# Project agent memory

checks judges a repository through small binaries called gates, and `README.md` holds what a person reads.

## Before you change a part

- A gate, its page under `docs/` or a shipped config: read [Find where a change goes](CONTRIBUTING.md#find-where-a-change-goes) first.
- Anything the Effect rules hold: read [The Effect rules](docs/configs/effect-rules.md) first.
- A test: read [Check a change](CONTRIBUTING.md#check-a-change) and [checks-test-layout](docs/gates/checks-test-layout.md) first.
- A doc page: read [checks-docs](docs/gates/checks-docs.md) first.
- A workflow: read [checks-ci-wiring](docs/gates/checks-ci-wiring.md) first.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows.
Point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
