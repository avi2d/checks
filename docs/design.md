# Why it is shaped this way

Each entry below is a choice in the kit's shape and the constraint that forced it.

- Every config in an oxlint `extends` chain brings its own `plugins`, and one that sets none brings oxlint's default plugins, whose category rules the base's `categories` then turn on across the tree.
  `rules`, `categories` and `jsPlugins` inherit as expected.
  That is why the consumer snippet restates `plugins` and nothing else, and why the generated fragment always sets them.
- `node_modules/` is excluded through the consumer's `.gitignore`, not `ignorePatterns`: oxlint still walks the installed package when only `ignorePatterns` names it.
- `files` in package.json is the published surface: `tests/`, `AGENTS.md` and the `.ts` plugin source never reach an install.
  npm adds `package.json`, `README` and `LICENSE` to the tarball whatever `files` says.
  `bun pm pack` builds the same tarball the registry serves, which is what the packed-tarball consumer e2e test installs.
- The plugin ships compiled as `dist/index.js`, built with `bun build effect-channel/index.ts --outdir dist --target node --format esm`.
  Node refuses to type-strip a `.ts` plugin under `node_modules`, so the `.ts` source would fail to load from an installed package.
- `featureRules` ships compiled as `dist/feature-rules.js` for the same reason, with `effect` left out of the bundle so it resolves the consumer's own copy.
  dependency-cruiser uses a config's export as it is and never awaits it, so the declaration decodes synchronously, and `quality.json` exempts that one file from the Effect rules.
- `checks-size-budget` writes the head commit's files to a temporary directory and runs oxlint there, with a configuration that sets no plugin and turns every category off, so the consumer's own `.oxlintrc.json`, its ignore files and its other rules never reach the count.
- `dist/` is committed.
  No `prepack` or `prepublishOnly` builds it, so a publish ships whatever bundle the publishing worktree holds.
  Rebuild it after pulling with `bun run build`.
  `bun run build` also emits `quality.schema.json`, `templates/` and `CHANGELOG.md`, which are committed the same way.
  CI runs `git diff --exit-code` over the whole tree after the build, because a test that compares a generated file with its source passes on the copy the build just rewrote.
- `CHANGELOG.md` is generated, so a release commit carries it and the tarball ships it.
  The commit that bumps package.json `version` closes its release, and the `v*` tag goes on that commit, so commits merged after it wait for the next release.
  Releases come from the commits, over all of HEAD's ancestry, so a checkout without tags, a fork and a branch that merged `main` in write the same file.
  A bump not newer than the release before it is a revert: it cancels every release above the version it returns to, and a tag only keeps a reverted release that was already published.
  The committed changelog is the record of what was released: a version older than the newest it lists and absent from it was never published, and its commits go into the next release.
  A section keeps the date it was written with, since the squash merge that lands the release commit may fall on another day.
  Entries come from commit subjects, the squash-merged pull request titles commitlint holds to the conventional format.
  The bodies are the branch's own messages, which nothing lints.
  The release path needs no `contents: write`: the changelog arrives in the release commit's pull request, not from a workflow that pushes.
- `quality.json` is JSON, not TOML or a TypeScript module: a bun bin, a hook running without `node_modules`, a `.cjs` or `.mjs` config and `jq` all parse it with nothing installed, and nobody runs a repository's own code to learn its policy.
  It holds declarations only.
  The kit's bins read it directly.
  oxlint and tsc read nothing but their own JSON, so they extend generated fragments, which `checks-quality --check` holds to the declarations.
- `quality.json` refuses a key its schema does not name, so a kit that cannot enforce a newer key refuses it rather than let the repository believe it enforced.
- The base parses with swc because typescript 7, which is tsgo, has no compiler API for dependency-cruiser to use.
  Without `@swc/core` installed the cruise silently skips every `.ts` file, so this repo's test asserts its own TypeScript is cruised.
- `bunfig.toml` has no `extends` and no include: bun ignores an unknown top-level key in silence, so a preset cannot be inherited and the consumer's copy is compared key by key against the installed one instead.
  `[test] pathIgnorePatterns` is a real bunfig key, and an empty `--path-ignore-patterns` flag overrides the file's own list.
- The Stryker preset is a JavaScript module, not JSON: Stryker 10 does not resolve `extends` in a JSON config, but a `.mjs` config that spreads an imported object consumes it.
  Keys the consumer sets after the spread win.
- The `.ts` bins are written in Effect, so `effect` is a peer dependency and `@effect/platform-bun`, which only the bins use, is a dependency.
  `@effect/platform-node-shared` is a direct dependency at the same exact version only to pin it: `@effect/platform-bun` asks for it with a `^` range, and a newer rc peers on a newer `effect` than consumers install, so all three move together.
- Each runnable script ships a `checks-` bin entry, so consumer `package.json` scripts call the short name, which the package manager puts on `PATH` only there.
  A shell runs it through `bun run`, which never falls back to the registry the way `bunx` does.
  The `.ts` checks keep a `bun` shebang, which needs no build step and no `dist/` entry, unlike the oxlint plugin that node loads.
- `checks-lint` runs each gate as its own bin in a child process rather than importing it, so a gate behaves the same called alone or through the entry point, and `lint-coverage.sh` stays a shell script.
  The gates run one at a time with their output passed straight through, so each report reads whole and in the table's order.
- A gate selection is checked against the repository's contents rather than trusted, so it cannot skip a gate that applies.
  ci-wiring does that check, which is why a selection without it, or without another gate that applies everywhere, is refused as `checks-lint` reads it: nothing would check the selection otherwise.
- `checks-test` runs bun itself rather than reading a report some other run left: a skip taken only on CI is visible only in CI's own run, and an earlier run's report may be stale or narrowed.
  It reads the JUnit report bun writes to a temporary directory, since bun has no other per-test output meant for a program.
- `checks-ci-wiring` runs inside `lint`, not in a workflow of its own: deleting the step that runs a check is the violation it catches, so the local `lint` is where it has to fail.
- Workflows are parsed with `Bun.YAML`, which the `bun` shebang already provides, so the check adds no dependency.
  It reads `on` as a string key, not as the YAML 1.1 boolean.
- `bun` counts as a built-in module.
  Nothing installed resolves it except `@types/bun`, which would otherwise make every runtime `bun` import look like a dev-only dependency.
- The pull request merge commit GitHub builds is authored by `GitHub <noreply@github.com>`, which commit-identity refuses as an author.
  `checks-lint` ends a pull request's range at the event's head sha, so the merge commit is never in it.
  A `lint` that calls `checks-commit-identity HEAD` itself checks out `github.event.pull_request.head.sha` instead of the default merge ref.
- `no-deep-imports` judges the import specifier, never the resolved file.
  The base honours `exports` maps, so a subpath the map publishes resolves and passes, one it omits fails to resolve and is reported, and a package without an `exports` map publishes every file.
  A bare import always passes whatever file its entry lives in.
  Setting your own `options.enhancedResolveOptions` replaces the base's, so restate `exportsFields` and `conditionNames` if you do.
- dependency-cruiser `extends` merges same-name `forbidden` rules with the child's fields winning.
  That is the entry-point and layer recipe under Boundaries in [The dependency rules](configs/dependency-rules.md).
- The templates in `templates/` are rendered from `scripts/doc-templates.ts`, the spec `checks-docs` reads.
  A template written by hand beside the check agrees with it only until someone edits one of them.
- A page's Diátaxis mode is declared in `quality.json` rather than read from the page.
  Whether a page teaches, walks a task, describes or explains is a judgment no program makes, so the repository states it once and the check holds the page to it.
- `checks-docs` holds a doc file to its template when a change touches it, the way `checks-size-budget` holds a file to its budget.
  A repository adopts the templates as its files change, and an untouched file is listed as advisory rather than failing a change that never read it.
- A task heading is verb first, and review holds it there rather than the check.
  No word list tells `Test layout` from `Test the layout`, and a check that passes the noun is worse than none.
- The prose rules judge only the lines a change adds or edits, the way `checks-comment-gate` judges comments.
  Text nobody touched never turns a change red, a record keeps the words it was written in, and a repository needs no cleanup pass before the gate runs.
- A living doc takes one sentence per line, so a changed line is a changed sentence.
  Under a hard wrap a one-word edit reflows a paragraph, and the gate would then demand fixes to sentences the edit never touched.
- `scripts/prose-matchers.ts` imports nothing, so the gate and a write-time hook run one matcher and refuse in the same words.
  A hook bundle ships without `node_modules`, so a matcher that needed Vale or a package could not refuse at write time.
- Readability grades and words such as easy stay out of the prose rules.
  A score cannot fail a change without failing correct prose, and a suggestion nobody runs an editor for is never seen.
- A path, link or command on a line the range leaves alone fails when the range broke it, as by deleting the file it names.
  A reference goes stale when the code it names moves far more often than when its own line is edited, so a gate on edited lines alone would miss the usual break.
- A path under a top directory the repository lacks names a file in another repository, such as a consumer's, and no program tells that from a typo.
  A directory the range deletes still counts as this repository's, so a path under it reads as stale rather than foreign.
- The command check passes over the docs a repository declares under `docs.forConsumers`.
  This kit's README and reference pages speak to a consuming repository, whose scripts are not this one's, and no program tells an example for a consumer from an instruction for a contributor.

## Related topics

- [checks](../README.md)
