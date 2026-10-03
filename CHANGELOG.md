# Changelog

Every release of `@avi2dg/checks`, newest first, written by the release from its conventional commits.

## 0.34.0

Released 2026-10-03.

### Features

- **delivery:** pin mutation jobs to winbox and default other jobs to hosted runners [#123](https://github.com/avi2d/checks/pull/123)

## 0.33.0

Released 2026-10-03.

### Features

- **docs:** report sentences over trial length caps as advisory [#120](https://github.com/avi2d/checks/pull/120)

### Fixes

- move effect to stable 4.0.0 [#122](https://github.com/avi2d/checks/pull/122)
- **complexity:** accept signed numbers and earlier props names in thin-astro defaults [#115](https://github.com/avi2d/checks/pull/115)
- **docs:** judge agent file entries and headings from a CommonMark parse [#116](https://github.com/avi2d/checks/pull/116)
- **docs:** fail link anchors the checks-docs reference rule could not check [#114](https://github.com/avi2d/checks/pull/114)

## 0.32.0

Released 2026-09-29.

### Features

- **delivery:** add checks-secrets gate that fails a range whose commits add a secret [#112](https://github.com/avi2d/checks/pull/112)
- **delivery:** open a release pull request daily and tag it when it merges [#111](https://github.com/avi2d/checks/pull/111)

## 0.31.0

Released 2026-09-28.

### Features

- lint .astro files in lint coverage, unused and a thin-frontmatter rule [#108](https://github.com/avi2d/checks/pull/108)

## 0.30.0

Released 2026-09-28.

### Features

- **testing:** refuse full mutation runs outside CI [#106](https://github.com/avi2d/checks/pull/106)
- **docs:** refuse a decision-record revision link named on one side only [#105](https://github.com/avi2d/checks/pull/105)

## 0.29.0

Released 2026-09-28.

### Breaking changes

- **docs:** hold agent files to a 3,000-character router where every entry points [#101](https://github.com/avi2d/checks/pull/101)

### Fixes

- **testing:** run checks-test with CI=true so focused tests fail locally [#100](https://github.com/avi2d/checks/pull/100)

## 0.28.0

Released 2026-09-28.

### Features

- **dependencies:** add checks-advisories gate for advisories a bun.lock change adds [#98](https://github.com/avi2d/checks/pull/98)

## 0.27.0

Released 2026-09-27.

### Breaking changes

- **quality:** add data-shape oxlint plugin for readonly params and schema twins [#96](https://github.com/avi2d/checks/pull/96)
- ship stricter type gates for any, optional keys, process.env and ts-reset [#94](https://github.com/avi2d/checks/pull/94)

### Features

- **docs:** check agent files, vanished names and reports about the past [#95](https://github.com/avi2d/checks/pull/95)

### Fixes

- describe the kit without naming its owner in the package description [#91](https://github.com/avi2d/checks/pull/91)

## 0.26.0

Released 2026-09-27.

### Breaking changes

- **complexity:** add checks-exports gate holding unused exports to a shrinking baseline [#89](https://github.com/avi2d/checks/pull/89)
- move doc templates into dist/templates and presets into src/quality [#88](https://github.com/avi2d/checks/pull/88)

## 0.25.0

Released 2026-09-27.

### Breaking changes

- stop shipping checks-backtest and unused exports keys, guard the tarball with Knip [#86](https://github.com/avi2d/checks/pull/86)
- sort the kit into src/<vector>/ and require tests/<level>/ [#84](https://github.com/avi2d/checks/pull/84)

### Features

- add checks-unused gate that rejects unreferenced TypeScript files via Knip [#85](https://github.com/avi2d/checks/pull/85)

## 0.24.2

Released 2026-09-27.

### Fixes

- **scripts:** list commits merged in after a bump under that release [#82](https://github.com/avi2d/checks/pull/82)
- **scripts:** leave versions with no listable commits out of the changelog [#81](https://github.com/avi2d/checks/pull/81)

## 0.24.1

Released 2026-09-27.

### Fixes

- **scripts:** let checks-changelog release a repository that gains its version late [#79](https://github.com/avi2d/checks/pull/79)

## 0.24.0

Released 2026-09-27.

### Features

- **scripts:** ship checks-changelog, checks-release-notes and checks-release-report bins [#77](https://github.com/avi2d/checks/pull/77)

### Fixes

- **scripts:** make checks-vendor re-freeze a cached tree whose owner write bit came back [#76](https://github.com/avi2d/checks/pull/76)

## 0.23.0

Released 2026-09-26.

### Breaking changes

- move cognitive-complexity into its own readability oxlint plugin [#74](https://github.com/avi2d/checks/pull/74)

## 0.22.0

Released 2026-09-26.

### Breaking changes

- replace quality.json with native configs and workflow gates [#72](https://github.com/avi2d/checks/pull/72)
- declare test skips inline and add live and pixel test tiers [#71](https://github.com/avi2d/checks/pull/71)

### Features

- create GitHub releases with linked changelogs [#70](https://github.com/avi2d/checks/pull/70)

### Fixes

- **scripts:** run generated commitlint through bun so the runner needs no node [#69](https://github.com/avi2d/checks/pull/69)
- **test:** allow npm pack enough time on release runners [#68](https://github.com/avi2d/checks/pull/68)

## 0.21.0

Released 2026-09-26.

### Features

- **scripts:** let quality.json set the runs-on of generated workflows [#66](https://github.com/avi2d/checks/pull/66)

## 0.20.0

Released 2026-09-26.

### Features

- **scripts:** pin node from .node-version in the generated CI workflow [#64](https://github.com/avi2d/checks/pull/64)
- **scripts:** add checks-subsumed-tests to report tests another test subsumes in a [#62](https://github.com/avi2d/checks/pull/62)

### Fixes

- **scripts:** lint a PR title that starts with # in the generated commitlint workflow [#63](https://github.com/avi2d/checks/pull/63)

## 0.19.0

Released 2026-09-26.

### Features

- **scripts:** judge checks-mutation-compare mutant by mutant instead of by score [#58](https://github.com/avi2d/checks/pull/58)
- **scripts:** fail a test left in tests/quarantine past 30 days [#59](https://github.com/avi2d/checks/pull/59)
- **scripts:** pin shared read-only library clones with checks-vendor [#57](https://github.com/avi2d/checks/pull/57)

## 0.18.0

Released 2026-09-26.

### Features

- **scripts:** generate commitlint and CI workflows with checks-quality [#54](https://github.com/avi2d/checks/pull/54)

### Fixes

- **scripts:** make checks-quality refuse a config that drops the kit's extends [#55](https://github.com/avi2d/checks/pull/55)

## 0.17.0

Released 2026-09-25.

### Features

- **effect-channel:** add a cognitive complexity rule and make it the size budget's [#50](https://github.com/avi2d/checks/pull/50)
- **scripts:** export the refused directive names from comment-matchers [#49](https://github.com/avi2d/checks/pull/49)
- refuse undeclared package imports and deprecated symbol use [#48](https://github.com/avi2d/checks/pull/48)

## 0.16.0

Released 2026-09-25.

### Features

- **scripts:** add checks-repetition to hold new repetition in production code [#46](https://github.com/avi2d/checks/pull/46)
- **scripts:** add the recommended size limits, a tests budget and an overrun ratchet [#45](https://github.com/avi2d/checks/pull/45)

## 0.15.0

Released 2026-09-25.

### Features

- **scripts:** hold living docs to prose rules and resolvable references in checks-docs [#42](https://github.com/avi2d/checks/pull/42)

## 0.14.0

Released 2026-09-25.

### Features

- **scripts:** generate README blocks, check CONTRIBUTING.md, and give each bin a page [#39](https://github.com/avi2d/checks/pull/39)
- **scripts:** generate CHANGELOG.md from conventional commits and ship it in the package [#40](https://github.com/avi2d/checks/pull/40)

## 0.13.0

Released 2026-09-25.

### Features

- **scripts:** add checks-docs gate holding doc files to shared templates [#37](https://github.com/avi2d/checks/pull/37)

## 0.12.0

Released 2026-09-24.

### Features

- **scripts:** add size budget, feature-owner rules and change-signal gates [#35](https://github.com/avi2d/checks/pull/35)

### Fixes

- release 0.12.0 and read local exports in checks-feature-owners [#36](https://github.com/avi2d/checks/pull/36)

## 0.11.0

Released 2026-09-24.

### Features

- **scripts:** add quality.json with schema, loader and checks-quality fragment generator [#33](https://github.com/avi2d/checks/pull/33)

## 0.10.0

Released 2026-09-24.

### Features

- **scripts:** add checks-test skip gate and checks-flake seed recorder [#31](https://github.com/avi2d/checks/pull/31)

## 0.9.0

Released 2026-09-24.

### Features

- **scripts:** let ciWiring.lintGates select the gates checks-lint runs [#29](https://github.com/avi2d/checks/pull/29)
- **oxlintrc:** turn on no-unsafe-type-assertion and no-non-null-assertion [#26](https://github.com/avi2d/checks/pull/26)

### Fixes

- **scripts:** split Effect-free comment matchers out for hosts without node_modules [#30](https://github.com/avi2d/checks/pull/30)
- **scripts:** judge a repository's first commit against the empty tree in the range gates [#28](https://github.com/avi2d/checks/pull/28)
- **lint:** cruise the whole repo; lint-coverage counts skips and exits 2 on a failed walk [#27](https://github.com/avi2d/checks/pull/27)

## 0.8.0

Released 2026-09-24.

### Features

- **scripts:** add checks-lint to run every kit lint gate over one resolved range [#25](https://github.com/avi2d/checks/pull/25)
- **scripts:** run the bins on Effect and hold scripts/ to Effect-native IO [#22](https://github.com/avi2d/checks/pull/22)

## 0.6.0

Released 2026-09-24.

### Features

- add checks-suppressions-ratchet to refuse a raised oxlint suppression count [#21](https://github.com/avi2d/checks/pull/21)

## 0.5.0

Released 2026-09-24.

### Features

- **effect-channel:** add opt-in no-throw and no-try-catch rules [#20](https://github.com/avi2d/checks/pull/20)

## 0.4.0

Released 2026-09-24.

### Features

- add checks-ci-wiring to confirm CI runs each declared gate on pull requests [#19](https://github.com/avi2d/checks/pull/19)

### Fixes

- pin the quarantine pathIgnorePatterns in the test-layout bunfig check [#18](https://github.com/avi2d/checks/pull/18)

## 0.3.0

Released 2026-09-23.

### Features

- add checks-mutation-compare no-regression gate for Stryker reports [#17](https://github.com/avi2d/checks/pull/17)
- ship a shared Stryker mutation-testing preset [#16](https://github.com/avi2d/checks/pull/16)

## 0.2.0

Released 2026-09-23.

### Features

- expose runnable scripts as checks- bins for consumer package scripts [#15](https://github.com/avi2d/checks/pull/15)
- rename npm package from @avi2d/checks to @avi2dg/checks [#14](https://github.com/avi2d/checks/pull/14)
- add a shared comment gate and backtest command [#12](https://github.com/avi2d/checks/pull/12)
- publish @avi2d/checks to the public npm registry [#11](https://github.com/avi2d/checks/pull/11)

### Fixes

- count violation lines from file top, drop dead moduleStart [#10](https://github.com/avi2d/checks/pull/10)
