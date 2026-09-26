---
kind: reference
audience: consumers
---
# checks-release-notes

`checks-release-notes` writes the `CHANGELOG.md` section of one version to a file for a GitHub release.

## What it checks

It reads the section the version heads and trims the blank lines around it.
It writes the notes to the output path.
It fails when the changelog holds no section for the version or the section is empty.

## What it reads

It reads `CHANGELOG.md` from the working directory.
It reads the version from its arguments, not from `package.json`.

## Arguments

```sh
checks-release-notes <version> <output>
```

The version names the `CHANGELOG.md` section to write, as `0.22.0` with no leading `v`.
The output names the file to write.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | The notes were written. |
| 2 | The arguments do not parse, or `CHANGELOG.md` holds no notes for the version. |

## Sample output

```
Released 2026-09-27.

### Features

- Add a release [#67](https://github.com/avi2d/checks/pull/67)
```

## Release workflow

Each consumer owns `.github/workflows/release.yml` and calls the kit bins from it.
The version lives in `package.json`, and the tag names the same version with a leading `v`.
The build writes the changelog, so the release pull request carries the notes before the tag exists.
A repository that publishes a package to npm releases with this workflow:

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: git diff --exit-code
      - name: tag matches package version
        run: test "v$(bun -p "require('./package.json').version")" = "$GITHUB_REF_NAME"
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      - run: npm publish
  github-release:
    needs: publish
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: extract release notes
        run: ./node_modules/.bin/checks-release-notes "${GITHUB_REF_NAME#v}" "$RUNNER_TEMP/release-notes.md"
      - name: create the GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes-file "$RUNNER_TEMP/release-notes.md"
```

A repository that never publishes to npm releases with this workflow instead, since only `checks` publishes a package:

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
jobs:
  github-release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: git diff --exit-code
      - name: tag matches package version
        run: test "v$(bun -p "require('./package.json').version")" = "$GITHUB_REF_NAME"
      - name: extract release notes
        run: ./node_modules/.bin/checks-release-notes "${GITHUB_REF_NAME#v}" "$RUNNER_TEMP/release-notes.md"
      - name: create the GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes-file "$RUNNER_TEMP/release-notes.md"
```

Cut a release by merging a pull request that holds only the version bump and the built changelog, then tagging the merge commit on the target branch and pushing the tag.
The workflow refuses a tag that disagrees with `package.json`, so the tag always names the section the notes come from.

## Opting out

Nothing runs it but the release workflow of a repository that publishes GitHub releases.
A repository with no versioned releases leaves it out.

## Related topics

- [checks-changelog](checks-changelog.md)
- [checks-release-report](checks-release-report.md)
