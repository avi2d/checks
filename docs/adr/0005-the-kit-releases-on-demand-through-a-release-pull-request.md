---
governs: [.github/workflows/release.yml]
---
# 0005. The kit releases on demand through a release pull request

Date: 2026-11-09

## Status

Accepted.

## Context

Every consumer takes the kit from npm by semver range, so each published version reaches every repository through a dependency bump.
Publishing on every push ships each merge as its own version, and each version sends one more bump through every consumer whether it needs the change or not.

## Decision

The kit releases only on demand, in the shape skills and orc use.
Firstmate starts a release, which opens a release pull request, merging it tags the version, and `release.yml` publishes from the tag.
Firstmate releases only for a reason: another repository needs a merged change, users need a fix, or merged changes have waited a week.
No push to main and no schedule publishes a version.

## Consequences

A merged change waits on main until the next release, and a repository that needs it sooner is a reason to release.
Each version gathers every change merged since the last one, so consumers take fewer bumps.
