# Changelog

Every release of `@avi2dg/checks`, newest first, written by the release from its conventional commits.

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
