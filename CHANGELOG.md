# Changelog

Every release of `@avi2dg/checks`, newest first, written by the release from its conventional commits.

## 0.19.0

Released 2026-09-26.

### Features

- **scripts:** judge checks-mutation-compare mutant by mutant instead of by score (#58)
- **scripts:** fail a test left in tests/quarantine past 30 days (#59)
- **scripts:** pin shared read-only library clones with checks-vendor (#57)

## 0.18.0

Released 2026-09-26.

### Features

- **scripts:** generate commitlint and CI workflows with checks-quality (#54)

### Fixes

- **scripts:** make checks-quality refuse a config that drops the kit's extends (#55)

## 0.17.0

Released 2026-09-25.

### Features

- **effect-channel:** add a cognitive complexity rule and make it the size budget's (#50)
- **scripts:** export the refused directive names from comment-matchers (#49)
- refuse undeclared package imports and deprecated symbol use (#48)

## 0.16.0

Released 2026-09-25.

### Features

- **scripts:** add checks-repetition to hold new repetition in production code (#46)
- **scripts:** add the recommended size limits, a tests budget and an overrun ratchet (#45)

## 0.15.0

Released 2026-09-25.

### Features

- **scripts:** hold living docs to prose rules and resolvable references in checks-docs (#42)

## 0.14.0

Released 2026-09-25.

### Features

- **scripts:** generate README blocks, check CONTRIBUTING.md, and give each bin a page (#39)
- **scripts:** generate CHANGELOG.md from conventional commits and ship it in the package (#40)

## 0.13.0

Released 2026-09-25.

### Features

- **scripts:** add checks-docs gate holding doc files to shared templates (#37)

## 0.12.0

Released 2026-09-24.

### Features

- **scripts:** add size budget, feature-owner rules and change-signal gates (#35)

### Fixes

- release 0.12.0 and read local exports in checks-feature-owners (#36)

## 0.11.0

Released 2026-09-24.

### Features

- **scripts:** add quality.json with schema, loader and checks-quality fragment generator (#33)

## 0.10.0

Released 2026-09-24.

### Features

- **scripts:** add checks-test skip gate and checks-flake seed recorder (#31)

## 0.9.0

Released 2026-09-24.

### Features

- **scripts:** let ciWiring.lintGates select the gates checks-lint runs (#29)
- **oxlintrc:** turn on no-unsafe-type-assertion and no-non-null-assertion (#26)

### Fixes

- **scripts:** split Effect-free comment matchers out for hosts without node_modules (#30)
- **scripts:** judge a repository's first commit against the empty tree in the range gates (#28)
- **lint:** cruise the whole repo; lint-coverage counts skips and exits 2 on a failed walk (#27)

## 0.8.0

Released 2026-09-24.

### Features

- **scripts:** add checks-lint to run every kit lint gate over one resolved range (#25)
- **scripts:** run the bins on Effect and hold scripts/ to Effect-native IO (#22)

## 0.6.0

Released 2026-09-24.

### Features

- add checks-suppressions-ratchet to refuse a raised oxlint suppression count (#21)

## 0.5.0

Released 2026-09-24.

### Features

- **effect-channel:** add opt-in no-throw and no-try-catch rules (#20)

## 0.4.0

Released 2026-09-24.

### Features

- add checks-ci-wiring to confirm CI runs each declared gate on pull requests (#19)

### Fixes

- pin the quarantine pathIgnorePatterns in the test-layout bunfig check (#18)

## 0.3.0

Released 2026-09-23.

### Features

- add checks-mutation-compare no-regression gate for Stryker reports (#17)
- ship a shared Stryker mutation-testing preset (#16)

## 0.2.0

Released 2026-09-23.

### Features

- expose runnable scripts as checks- bins for consumer package scripts (#15)
- rename npm package from @avi2d/checks to @avi2dg/checks (#14)
- add a shared comment gate and backtest command (#12)
- publish @avi2d/checks to the public npm registry (#11)

### Fixes

- count violation lines from file top, drop dead moduleStart (#10)
