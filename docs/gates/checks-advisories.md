---
kind: reference
audience: consumers
---
# checks-advisories

`checks-advisories` is the gate that fails a range whose `bun.lock` change adds a package version with a known security advisory.

## What it checks

It scans `bun.lock` at both ends of the range with OSV-Scanner and fails on each advisory the head's lockfile has and the base's lockfile lacks.
It matches an advisory across the range by package name and id, so a range that moves a package between two affected versions adds nothing.
It matches by alias only when the head no longer holds the base's id, because two live advisories can list each other as aliases.
An advisory published against a package the base already held shows at both ends, so it fails no range, and `--all` reports it instead.
Each failure names the package, its version, the advisory id, its severity and its summary.
A range that leaves `bun.lock` unchanged runs no scan.
It also holds `advisory-acks.json` to the rules in [The acknowledgement file](#the-acknowledgement-file) on every run.

## What it reads

It reads `bun.lock` at the base and at the head of the range from git, not from the working tree.
It scans copies of both in a scratch directory with an empty config, so a repository's own `osv-scanner.toml` takes no part.
It reads the advisories OSV.dev exports for npm, which hold GitHub's reviewed advisories and OpenSSF's reports of malicious packages.

It runs OSV-Scanner 2.6.0, pinned by the SHA-256 of each platform's build.
On first use it downloads the build from the scanner's GitHub release into `~/.cache/avi2dg-checks/osv-scanner/2.6.0/`.
It checks the SHA-256 again on every run and exits 2 on a copy that differs.
Builds are pinned for macOS and Linux, each on x64 and arm64.
On any other platform it exits 2, and no setting runs a scanner other than the pinned build.

It scans offline against OSV-Scanner's npm database in `~/.cache/avi2dg-checks/osv-scanner/db/`.
When the last refresh is more than 24 hours old, the scan asks for the database again, and OSV-Scanner downloads it only when the copy differs.
A last refresh dated ahead of the clock counts as no refresh.
When that download fails, it scans the cached copy and says so, as long as that copy was refreshed within 7 days.
With no copy refreshed within 7 days it exits 2.
A cold cache downloads about 55 MB of scanner and 217 MB of database.

`--all` appends its report to the file `GITHUB_STEP_SUMMARY` names, which is the job summary.

## The acknowledgement file

`advisory-acks.json` at the repository root lists the advisories the repository accepts for a while, such as a false positive or a fix that waits on an upstream release:

```json
[
  {
    "package": "minimist",
    "id": "GHSA-xvch-5gv4-984h",
    "until": "2026-10-20",
    "reason": "mkdirp 0.5.1 never parses untrusted argv here, and leaves with the next test runner"
  }
]
```

It reads the file at the head of the range.
Each entry names the package, one id or alias of the advisory, the day the entry stops holding, and why the repository accepts the advisory.
An entry naming an id the head holds covers that advisory alone, and one naming any other id covers each advisory that lists it as an alias.
An entry holds until its `until` day begins in UTC.
A range measures from the later of the head's author and committer dates, so a commit gets the same verdict on every run.
`--all` measures from the current time, so an entry expires in a repository that takes no commit.
An entry whose `until` falls more than 30 days after that moment fails the run and covers nothing, and no setting raises the limit.
Once that moment passes `until`, the entry fails every run until the package is upgraded or the entry is renewed with a new reason, whether or not the range touches `bun.lock`.
When a scan runs, an entry that matches no advisory at the head fails, so the file holds only live entries.
A file that does not decode as that list exits 2.

## Arguments

```sh
checks-advisories <base-ref> <head-ref>
checks-advisories <ref>
checks-advisories --all
```

With two arguments it judges the range from their merge base to the head.
With one it judges that commit against its parent, or against an empty tree for a repository's first commit.
With `--all` it fails on every advisory in `bun.lock` at `HEAD` that no entry covers.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the range adds no advisory to `bun.lock`, and every acknowledgement holds |
| 1 | the range adds an advisory no acknowledgement covers, or an acknowledgement does not hold |
| 2 | a ref does not resolve, `advisory-acks.json` does not decode, or no verified scanner or usable database is at hand |

## Sample output

```
advisories: the range adds 2 advisory(ies) to bun.lock (0 at the head predate the range, 0 acknowledged); upgrade each package, or acknowledge its advisory in advisory-acks.json:
  lodash@4.17.20 GHSA-35jh-r3h4-6jhm high: Command Injection in lodash
  minimist@0.0.8 GHSA-xvch-5gv4-984h critical: Prototype Pollution in minimist
advisories: 1 acknowledgement(s) in advisory-acks.json do not hold:
  qs GHSA-4mjr-xmp4-gh2g expired on 2026-10-20; upgrade the package, or renew the entry with a new reason
```

## When it runs

`checks-lint` runs it over each pull request's range in a repository that tracks `bun.lock`, as [checks-lint](checks-lint.md) says.
A range that leaves `bun.lock` unchanged runs in under a second, and one that changes it scans for about 10 seconds on a warm cache.

## Running it on a schedule

A range never fails on an advisory published after its package landed, so a scheduled `--all` run finds those:

```yaml
on:
  schedule:
    - cron: "41 4 * * *"
  workflow_dispatch:
jobs:
  advisories:
    runs-on: self-hosted
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: ./node_modules/.bin/checks-advisories --all
```

A self-hosted runner keeps `~/.cache/avi2dg-checks/` between runs, so it downloads the scanner once per pinned version and the database about once a day.
A hosted runner starts each run with an empty cache, so each run downloads both.

## Related topics

- [checks-lint](checks-lint.md)
- [Why it is shaped this way](../design.md)
