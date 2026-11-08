---
governs: [.github/workflows/release-push.yml]
---
# 0005. The kit publishes to npm on every push

Date: 2026-11-02

## Status

Accepted.

## Context

Every consumer takes the kit from npm by semver range, so a fix reaches a consumer only once it is published.
Waiting for a person to start each publish leaves a fix merged on main but absent from every consumer.
A green main is already the bar a release has to clear.

## Decision

`release-push` publishes a release from every push to main, with no one asked first.

## Consequences

Each merge to main ships as its own version, and consumers pick it up on their next install.
