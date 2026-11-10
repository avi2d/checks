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
A commit that GitHub committed allows any author name with an allowed email.
GitHub authors a web merge under the account's display name.
The same author on a commit with any other committer must match the allowed name too.
`github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>` is allowed as author only of a commit whose subject is `chore: release <version>`, with or without the pull request number a squash merge adds.
GitHub attributes the release commit [checks-release-pr](checks-release-pr.md) makes to that bot, since it commits through the workflow token.
Such a commit may carry a `Co-authored-by` trailer naming that bot, since GitHub adds one to some squash merges of a pull request the bot opened, and every other trailer is refused.
`dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>` is allowed as author only of a commit GitHub signed with its current web-flow key, whatever the commit's subject.
GitHub signs the commit Dependabot pushes and commits it as `GitHub <noreply@github.com>`, which the gate already allows as committer.
A commit GitHub signed may also carry a `Co-authored-by` trailer naming that identity.
GitHub adds one when the owner squash-merges a pull request the bot opened, and every other trailer is refused.
On a commit without that signature, the identity is refused as author and as co-author.
So a commit anyone can write under the bot's name never passes.
A signature that no longer covers the commit's bytes is refused too.
A signature by GitHub's key that expired in January 2024 is refused, since GitHub signs every new commit with its current key.
GitHub still shows such an old commit as verified.
This identity matches by name and email, even on a commit GitHub signed, so the Dependabot address under another name is refused.
Its `Signed-off-by` trailer is not a `Co-authored-by` trailer, so the gate does not read it.

## What it reads

`package.json` uses its standard `author` and `contributors` fields for allowed authors.
Each person can be any form npm allows, an object with `name` and optional `email` and `url`, or a string such as `Avi <avi@example.com> (https://example.com)`.
A person with both a name and an email is an allowed author.
A person without an email is ignored.
When no person carries an email, no identity is allowed, so the check fails every commit until the repository declares its owners.
The bin reads commits from git and parses their trailer blocks.
For a commit that names the Dependabot identity, it checks the commit's signature with `gpgv` against `src/delivery/github-web-flow.gpg` in the installed package.
That file is GitHub's web-flow keys exactly as `https://github.com/web-flow.gpg` publishes them.
The check runs offline and reads no keyring of the user's own, so a key that only calls itself GitHub does not pass.
It needs `gpgv` from GnuPG only when such a commit is in the range, and exits 2 when `gpgv` cannot run.

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
| 1 | A commit carries a foreign identity, or `package.json` declares no authors. |
| 2 | A ref, argument or `package.json` cannot be decoded, or `gpgv` cannot run to check a signature. |

## Sample output

```
commit-identity: 1 of 1 commit(s) in HEAD carry a foreign identity:
  79fa94f9f027 feat: foreign
    author someone <someone@example.com>
  allowed: Repo Owner <owner@example.com>
  allowed as committer only: GitHub <noreply@github.com>, which also lets an allowed email author under any name
  allowed as release author only: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>
  allowed as author or co-author only on a commit GitHub's current key signed: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
```

A commit under the Dependabot identity that GitHub did not sign names that:

```
commit-identity: 1 of 1 commit(s) in HEAD carry a foreign identity:
  3c0e5d2a91f4 chore(deps): bump actions/upload-artifact from 4 to 7
    author dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com> on a commit GitHub's current key did not sign
```

## When it runs

`checks-lint` runs it over each pull request's range in every repository.
A repository allows another author by adding them to `author` or `contributors` in `package.json`.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-lint](checks-lint.md)
