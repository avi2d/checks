---
kind: reference
audience: consumers
---
# checks-commit-identity

`checks-commit-identity` checks a commit's author and committer against the owners in `package.json` and refuses coauthor trailers.

## What it checks

The author and committer of each commit must be allowed.
A commit whose trailer block carries a `Co-authored-by` trailer, as git parses it, is refused.
`GitHub <noreply@github.com>` is allowed as committer only.
`github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>` is allowed as author only of a commit whose subject is `chore: release <version>`, with or without the pull request number a squash merge adds.
GitHub attributes the release commit [checks-release-pr](checks-release-pr.md) makes to that bot, since it commits through the workflow token.
Such a commit may carry a `Co-authored-by` trailer naming that bot, since GitHub adds one to some squash merges of a pull request the bot opened, and every other trailer is refused.

## What it reads

`package.json` uses its standard `author` and `contributors` fields for allowed authors.
Each person can be any form npm allows, an object with `name` and optional `email` and `url`, or a string such as `Avi <avi@example.com> (https://example.com)`.
A person with both a name and an email is an allowed author.
A person without an email is ignored.
When no person carries an email, the kit allows `avi2d <avi2dg@gmail.com>`.
The bin reads commits from git and parses their trailer blocks.

## Arguments

```sh
checks-commit-identity <base-ref> <head-ref>
checks-commit-identity <ref>
```

With two arguments, the bin checks every commit the head holds and the base does not.
With one argument, it checks that commit alone.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every commit carries an allowed identity. |
| 1 | A commit carries a foreign identity. |
| 2 | A ref, argument or `package.json` cannot be decoded. |

## Sample output

```
commit-identity: 1 of 1 commit(s) in HEAD carry a foreign identity:
  79fa94f9f027 feat: foreign
    author someone <someone@example.com>
  allowed: avi2d <avi2dg@gmail.com>
```

## When it runs

`checks-lint` runs it over each pull request's range in every repository.
A repository allows another author by adding them to `author` or `contributors` in `package.json`.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-lint](checks-lint.md)
