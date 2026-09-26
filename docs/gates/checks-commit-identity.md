# checks-commit-identity

`checks-commit-identity` checks a commit's author, committer and coauthor trailers against the owners in `package.json`.

## What it checks

The author and committer of each commit must be allowed.
Each `Co-authored-by` trailer must also name an allowed author.
`GitHub <noreply@github.com>` is allowed as committer only.

## What it reads

`package.json` uses its standard `author` and `contributors` fields for allowed authors.
Each identity can be an object with `name` and `email`, or a string such as `Avi <avi@example.com>`.
Without either field, the kit allows `avi2d <avi2dg@gmail.com>`.
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
| 2 | A ref, argument or package identity cannot be decoded. |

## Sample output

```
commit-identity: 1 of 1 commit(s) in HEAD carry a foreign identity:
  79fa94f9f027 feat: foreign
    author someone <someone@example.com>
  allowed: avi2d <avi2dg@gmail.com>
```

## Opting out

This gate runs on every repository through `checks-lint`.
The repository adds owners through `package.json` rather than omitting the gate.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-lint](checks-lint.md)
