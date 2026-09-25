# checks-commit-identity

`checks-commit-identity` is the gate that refuses a commit carrying an identity other than the repository owner's, and a reader looks it up to allow another author.

## What it checks

It walks every commit in a range and fails when one carries an identity outside the allowlist, naming the offending commit and the reason.
It refuses a commit whose author or committer is outside the allowlist.
It refuses a commit whose trailer block carries a `Co-authored-by:` trailer, as git parses it.
Other trailers, and prose in the body that mentions an address, are left alone.
`GitHub <noreply@github.com>` is allowed as committer only, since that is who writes a squash merge.

## What it reads

It reads the author, the committer and the trailers of each commit in the range, and `commitIdentity.authors` from `quality.json`.
The allowlist is `avi2d <avi2dg@gmail.com>` when `quality.json` declares none.

## Arguments

```sh
checks-commit-identity <base-ref> <head-ref>
checks-commit-identity <ref>
```

With two arguments it checks every commit the head holds and the base does not.
With one it checks that commit alone.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every commit carries only allowed identities |
| 1 | a commit carries a foreign identity |
| 2 | a ref does not resolve, the arguments do not parse, or `quality.json` does not decode |

## Sample output

```
commit-identity: 1 of 1 commit(s) in HEAD carry a foreign identity:
  79fa94f9f027 feat: foreign
    author someone <someone@example.com>
    committer someone <someone@example.com>
  allowed: avi2d <avi2dg@gmail.com>
  allowed as committer only: GitHub <noreply@github.com>
```

## Opting out

It applies to every repository, so no selection leaves it out.
A repository with other owners restates the allowlist in `quality.json`:

```json
"commitIdentity": {
  "authors": [{ "name": "avi2d", "email": "avi2dg@gmail.com" }]
}
```

`checks-lint` runs it over each pull request's range, as [checks-lint](checks-lint.md) says.

## Related topics

- [The commit message lint](../configs/commit-messages.md)
- [checks-lint](checks-lint.md)
