---
governs: [src/delivery/bun-pin.ts, .bun-version]
---
# 0003. The kit fails a repository whose Bun pin drifts from the fleet version

Date: 2026-10-14

## Status

Accepted.

## Context

A self-hosted runner holds one bun.
The `oven-sh/setup-bun` v2 step reuses that bun only when the version it resolves equals it exactly, and any other version downloads, at about 10 minutes per job on a self-hosted runner.
A step with no pin resolves to latest, so it downloads on every job.
A repository's CI cannot read the private machine setup that pins the runners' bun, so the version has to reach it some other way.

## Decision

The kit carries the fleet bun version in its own `.bun-version`, equal to the bun the runner machines install.
`checks-ci-wiring` fails a repository whose setup-bun version is missing or differs from the fleet version.
A step through the shared setup action is judged by the repository's `.bun-version` the same way.
A bun bump ships as one kit release plus one pin change in each repository.

## Consequences

Each consumer stays red from the kit release that moves the fleet version until its own pin follows.
A range or an expression for the version fails, since neither can be shown equal before the run.
A repository with neither a setup-bun step nor the shared setup step is left alone.
