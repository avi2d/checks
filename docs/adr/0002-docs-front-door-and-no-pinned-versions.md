# 0002. The docs keep a short README, sort every other page by kind and copy no pinned version

Date: 2026-10-25

## Status

Accepted.

## Context

The README held 277 lines that mixed four kinds of page: an install guide, the gate table, an upgrade guide and the shipped paths.
It listed Bun and all 16 peers at their versions, which `package.json` and `.bun-version` already hold.
Three gate pages wrote an optional peer's version by hand, and bumping that peer in `package.json` left them stale while `checks-docs` still passed.
The kit's README, how-to and tutorial templates asked every repository to write each prerequisite with the version it is tested on.

Three sources were read for how a project writes its docs:

- GitLab's [documentation style guide](https://docs.gitlab.com/development/documentation/styleguide/) makes the docs the single source of truth and asks a writer to link to an answer rather than rephrase it.
  Its [topic types](https://docs.gitlab.com/development/documentation/topic_types/) sort every page as a concept, a task, a reference or a troubleshooting page, with tutorials and a *Get started* page on top, and each page ends in *Related topics*.
  Its [site architecture](https://docs.gitlab.com/development/documentation/site_architecture/) keeps the docs in the repository, in folders by product area.
- Vue's [writing guide](https://github.com/vuejs/docs/blob/main/.github/contributing/writing-guide.md) splits its docs into a guide read in order, an [API reference](https://vuejs.org/api/) read like dictionary entries, and a cookbook, and asks a writer to prefer a link over repeating content.
  The [Vue core README](https://github.com/vuejs/core/blob/main/README.md) is 60 lines and sends every reader to the docs site for getting started.
- [Diátaxis](https://diataxis.fr/) names four kinds of page, tutorial, how-to guide, reference and explanation, and says that blurring them is at the heart of most documentation problems.

Neither project checks a version in its docs, and each shows the drift.
The [GitLab README](https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md) named Ruby 3.3.10 while its [`.ruby-version`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/.ruby-version) held 3.4.10 on 2026-10-24.
Vue's [quick start](https://vuejs.org/guide/quick-start.html) restates the Node range `create-vue` declares in `engines`.

## Decision

A repository the kit holds writes its README as a front door.
It holds what the project is, who it is for and why to use it, the prerequisites, an install of at most a few steps that ends in what the reader sees, a table of links out and *Related topics*.
Every other page lives under `docs/` and declares its kind in front matter, so each is a tutorial, a how-to under `docs/how-to/`, a reference page or an explanation such as `docs/design.md`.
The folder is the docs home, it ships in the package, and the README links resolve both on GitHub and from `node_modules`.

No doc writes by hand a version that `package.json`, `engines`, `.bun-version` or a lockfile holds.
A doc names the file that holds the version instead.
A command that needs the exact version is written by a build between generated markers, from the manifest, and a test fails on a stale copy.
`checks-docs` refuses a line a change adds that copies a version the root `package.json` or `.bun-version` pins, and the templates ask each prerequisite to name the file that pins its version.

## Consequences

The kit's README is 51 lines, and its guides are `docs/how-to/set-up-a-repository.md`, `docs/how-to/upgrade-the-kit.md` and `docs/how-to/turn-on-the-css-families.md`.
Every repository the kit holds meets the version rule on the lines it changes, through the next release, and meets the template change as it edits each README or how-to.
A sample transcript or a worked example that happens to carry the exact pinned version fails too, and takes another version.
A docs site is not built while a repository's `docs/` folder reads well on GitHub.
