# Vision

checks is the kit of gates that holds each Bun repository it runs in to one set of rules.

## Purpose

checks exists so that a rule a reviewer would otherwise have to remember runs as a program on every pull request.

## Serves

The people and coding agents who change a TypeScript repository on Bun, and who need each failure to name the file or line to fix.

## Owns

The gates, the shared configs and the doc templates that `checks-lint` runs in one command.
Its edge is judging: a gate reads a repository and reports what to fix, and a few bins write the files a gate asks for.

## Non-goals

- It does not hold a repository that runs on a runtime other than Bun.
- It does not keep a setting anywhere but the file its tool reads.
- It does not fix a finding for the person or agent who made the change.

## Direction

- Each rule a reviewer still has to remember becomes a gate.
- Each record in `docs/adr/` stays tied to the paths it governs.

## Constraints

- Every script is TypeScript with Effect.
- A function stays within a cognitive complexity of 15.
- A doc names the file that pins a version, never the version.
