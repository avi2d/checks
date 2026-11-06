# Changelog

Every release of `@avi2dg/checks`, newest first, written by the release from its conventional commits.

## 0.68.1

Released 2026-11-06.

### Fixes

- **commitlint:** accept Dependabot titles that open with Bump or Update [#50](https://github.com/avi2d/checks/pull/50)

## 0.68.0

Released 2026-11-06.

### Features

- **ci-wiring:** accept short shared refs for runner pick and setup [#49](https://github.com/avi2d/checks/pull/49)

## 0.67.0

Released 2026-11-06.

### Features

- **ci-wiring:** accept shared runner pick and setup action [#48](https://github.com/avi2d/checks/pull/48)

## 0.66.0

Released 2026-11-05.

### Features

- **docs:** cap READMEs at 6,000 characters and table cells at 300 [#46](https://github.com/avi2d/checks/pull/46)

## 0.65.3

Released 2026-11-04.

### Fixes

- **ci-wiring:** require the night run step in TypeScript repositories [#45](https://github.com/avi2d/checks/pull/45)

## 0.65.2

Released 2026-11-04.

### Fixes

- **testing:** stop filing failed issues for fully undecided night runs [#43](https://github.com/avi2d/checks/pull/43)

## 0.65.1

Released 2026-11-03.

### Fixes

- allow weekly advisory scan in any public repository [#42](https://github.com/avi2d/checks/pull/42)

## 0.65.0

Released 2026-11-03.

### Features

- **ci-wiring:** one CI run per pull request, refuse schedules and long jobs [#41](https://github.com/avi2d/checks/pull/41)

## 0.64.0

Released 2026-11-03.

### Features

- **testing:** shard the night mutation run and file each missing report [#27](https://github.com/avi2d/checks/pull/27)

## 0.63.1

Released 2026-11-03.

### Fixes

- **testing:** note a cleared mutation issue once [#29](https://github.com/avi2d/checks/pull/29)

## 0.63.0

Released 2026-11-03.

### Features

- **testing:** close cleared test and gate issues and note cleared mutation issues [#28](https://github.com/avi2d/checks/pull/28)

## 0.62.1

Released 2026-11-02.

### Fixes

- **dependencies:** raise minimatch to 11.0.3 and qs override to 6.16.1 [#25](https://github.com/avi2d/checks/pull/25)

## 0.62.0

Released 2026-11-02.

### Features

- **testing:** picture one block at each screen size in chromium and webkit [#24](https://github.com/avi2d/checks/pull/24)

## 0.61.1

Released 2026-11-02.

### Fixes

- **changelog:** keep a release's section when its commit gets its tag [#23](https://github.com/avi2d/checks/pull/23)

## 0.61.0

Released 2026-11-01.

### Features

- **ci-wiring:** refuse a scheduled release in every repository [#22](https://github.com/avi2d/checks/pull/22)

## 0.60.0

Released 2026-10-31.

### Features

- **browser:** export the screen sizes for a site to import [#21](https://github.com/avi2d/checks/pull/21)

## 0.59.0

Released 2026-10-31.

### Features

- **browser:** add shared screen size presets and starter declaration [#20](https://github.com/avi2d/checks/pull/20)

## 0.58.1

Released 2026-10-29.

### Fixes

- **browser:** judge where the pointer lands instead of timing the hover [#19](https://github.com/avi2d/checks/pull/19)

## 0.58.0

Released 2026-10-29.

### Features

- **delivery:** scan commit messages for secrets and pack terms [#17](https://github.com/avi2d/checks/pull/17)

## 0.57.1

Released 2026-10-29.

### Fixes

- **complexity:** time out graphwalk and its dependency cruiser child [#18](https://github.com/avi2d/checks/pull/18)

## 0.57.0

Released 2026-10-27.

### Features

- **testing:** run live tier and four lint gates at night [#13](https://github.com/avi2d/checks/pull/13)

## 0.56.1

Released 2026-10-27.

### Fixes

- **complexity:** merge unused, exports and imports walks into one pass [#12](https://github.com/avi2d/checks/pull/12)

## 0.56.0

Released 2026-10-27.

### Features

- **core:** scope lint gates by changed paths and add desk run [#11](https://github.com/avi2d/checks/pull/11)

## 0.55.0

Released 2026-10-27.

### Features

- **dependencies:** defer the advisory scan to the scheduled run [#10](https://github.com/avi2d/checks/pull/10)

## 0.54.1

Released 2026-10-27.

### Fixes

- resolve the lint gate tools from the repository's own install [#9](https://github.com/avi2d/checks/pull/9)

## 0.54.0

Released 2026-10-27.

### Features

- **delivery:** fail fast when the release cannot run [#8](https://github.com/avi2d/checks/pull/8)

## 0.53.0

Released 2026-10-26.

### Features

- **delivery:** release each push to main as a versioned npm release [#5](https://github.com/avi2d/checks/pull/5)
- **delivery:** keep private terms out of commits and pull request text [#2](https://github.com/avi2d/checks/pull/2)

### Fixes

- **delivery:** skip pr-text scan when CHECKS_SECRETS_PACK is unset [#6](https://github.com/avi2d/checks/pull/6)
