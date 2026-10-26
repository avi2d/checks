---
kind: reference
audience: consumers
---
# checks-pr-text

`checks-pr-text` scans the title, the body and every comment of a public pull request for a secret or a term of the private pack.

## What it checks

It scans the title, the body, each conversation comment, each review and each review comment, with the rules [checks-secrets](checks-secrets.md) runs on a commit.
On a fork's pull request a review or a review comment starts no scan, because GitHub gives those runs no secret.
That text is scanned only when another trigger runs next.
It adds the private pack when `CHECKS_SECRETS_PACK` names one, as [The private pack](checks-secrets.md#the-private-pack) describes, and its last line says whether the pack ran.
With `CHECKS_SECRETS_PACK` set but the pack unable to serve, it exits 2 and scans nothing.
It reads the text as it stands now, so a text edited clean passes on the next run.
A finding names the text, its line and its rule, and never the matched text.
A finding location prints as it stands, such as a link.
So a term inside a repository name shows there.
That location is already public in the scanned pull request.

Deleting a finding from the current text leaves it in GitHub's edit history of that text, which the text's edit menu deletes revision by revision.
The timeline keeps a renamed title's old text, and only GitHub Support removes it.

## What it reads

It calls `gh api` with `GH_TOKEN` for the pull request and its three kinds of comment, in the repository of the checkout's remote.
It reads the path of the private pack from `CHECKS_SECRETS_PACK`, and the kit's rules from `src/delivery/gitleaks.toml` in the installed package.
It writes each text to a file in a temporary directory, and deletes the directory when the scan ends.

## Arguments

| Argument | Meaning |
| --- | --- |
| `<pull-request-number>` | the number of the pull request to scan |

## Exit codes

| Code | Result |
| --- | --- |
| 0 | No text carries a secret or a term of the pack. |
| 1 | A text carries a secret or a term of the pack. |
| 2 | The argument is not one pull request number, `gh api` fails, no verified scanner is at hand, gitleaks fails, or `CHECKS_SECRETS_PACK` is set and the pack cannot serve. |

## Sample output

```
pr-text: pull request 42 carries 2 secret(s) or private term(s); delete each from the text it names, and delete the revision GitHub keeps in that text's edit history:
  the body:3 private-domain: A domain the private pack lists
  https://github.com/owner/repo/pull/42#issuecomment-1:1 private-name: A name form the private pack lists
pr-text: the kit's rules and the private pack CHECKS_SECRETS_PACK names ran
```

## When it runs

A public repository runs it from a workflow of its own on every change to a pull request's text:

```yaml
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened]
  issue_comment:
    types: [created, edited, deleted]
  pull_request_review:
    types: [submitted, edited]
  pull_request_review_comment:
    types: [created, edited, deleted]
```

The job writes the pack from a secret, as [The private pack](checks-secrets.md#the-private-pack) shows, then runs `bunx checks-pr-text` with the pull request's number.
It skips the scan when the secret is unset, as [When no pack is configured](#when-no-pack-is-configured) says.
`pull_request_target` runs the base branch's workflow with the repository's secrets, even for a fork's pull request.
The job reads the text through the API and checks out none of the pull request's code, so a fork runs nothing there.
A comment's run reports on no pull request, so the job posts its result as a `pr-text` status on the head commit.
The kit's own `.github/workflows/pr-text.yml` is a complete example.

## When no pack is configured

The kit's workflow skips the scan when `CHECKS_SECRETS_PACK` is unset or empty, instead of failing.
It writes a notice and a job summary line that say so, and posts a `pr-text` status of success whose description reads `scan skipped: no private pack is configured (CHECKS_SECRETS_PACK is unset)`.
A skip is a coverage gap, not a pass: no private term was checked on that pull request.
Only the repository secret decides a skip, so no input from a pull request's author can cause one.
To scan with the pack, set the repository secret `CHECKS_SECRETS_PACK` to the pack's JSON, as [The private pack](checks-secrets.md#the-private-pack) describes.
The next eligible run then scans the text with it.
On a fork's pull request a review or a review comment still starts no run, so that text waits for another trigger.

## Related topics

- [checks-secrets](checks-secrets.md)
- [checks-commit-title](checks-commit-title.md)
