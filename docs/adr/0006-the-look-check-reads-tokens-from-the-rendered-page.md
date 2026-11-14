---
governs: [src/quality/browser/look.ts]
---
# 0006. The look check reads tokens from the rendered page

Date: 2026-11-13

## Status

Accepted. Supersedes the rendered-token sentence of 0004, which names this record back.

## Context

The board met on 2026-11-13 for the look audit of avi2d.com with two options on the table.
Option A was the stylelint rules for line height, letter spacing, font weight and text transform, already released in the kit.
Option B was a rendered-page check built after those rules and after the avi2d.com look findings were fixed on main.
The audit read seven properties per element: colour, font size, weight, line height as a ratio of font size, letter spacing in em of the element's own size, text transform and font family.
The kit needed a way to hold the rendered page to tokens without taking on a token format of its own.

## Decision

The `look` check of `checks-browser` runs after the stylelint source rules and compares computed values with the custom properties the page itself declares.
It reads the custom properties from the page's own stylesheets at each route and viewport in the default state.
It resolves each token where the text sits, so a scoped class, a media query change or a container unit counts with its value there.
The kit keeps no token file format, since the page is the token source.

## Consequences

A product declares the roles `look` judges in `browser-checks.json` and keeps its tokens as custom properties in its own stylesheets.
The rendered-token sentence of 0004 no longer holds, and the Status of each record names the other.
A token set that is itself wrong stays out of reach, as do hover and focus looks, which stay deferred.
