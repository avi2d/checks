---
kind: reference
audience: consumers
---
# checks-plain-steps

`checks-plain-steps` is the gate that refuses a workflow or action step whose `run` holds more than one plain command.

## What it checks

The logic a step needs lives in a shared workflow or action in `avi2d/workflows`, with its tests there.
Any other repository's workflows only call them.
A step that uses a shared workflow or action passes, and so does a step whose `run` is one plain command, such as `bun run test`, or `bun scripts/smoke-pack.ts` in `avi2d/workflows`.

One plain command is one line of words that runs one program.
The check refuses a `run` that holds any of these:

- a block scalar, `run: |` or `run: >`, even around a single command
- a value that spans more than one line, quoted or plain
- a `run` the check cannot locate in the file, such as through a YAML anchor or in flow style
- a pipe, `|`
- a command list, `&&`, `||` or `;`, or a background job, `&`
- a redirect, such as `>`, `>>`, `<` or `2>&1`
- a here-document, `<<`
- a command substitution, `$(...)` or backticks, or a subshell in parentheses
- a backslash, inside quotes or out, since an escape is data the command should read from a file
- a parameter expansion other than `$NAME` or `${NAME}`, such as `${NAME:-default}`
- a shell comment
- inline interpreter code through a program the check reads, which is `sh`, `bash`, `dash`, `ksh` or `zsh` with `-c`, `node` or `bun` with `-e`, `--eval`, `-p` or `--print`, `python` or `python3` with `-c`, `perl` with `-e` or `-E`, `ruby` with `-e`, `php` with `-r`, `osascript` with `-e`, `deno eval`, `pwsh` or `powershell` with a `-Command`, `-EncodedCommand` or `-CommandWithArgs` parameter, `cmd` with `/c` or `/k`, `eval`, `awk`, `gawk`, `mawk`, `nawk` or `sed` with the program on the line, or `npx` with `-c` or `--call`
- the check reads those programs through the launchers `time`, `env`, `exec`, `nohup`, `sudo`, `bunx` and `npx`, where a launcher given by path counts as its base name, and through the wrappers `timeout`, `nice`, `xargs`, `docker run` and `find -exec`
- a program named by an expression, such as `run: ${{ inputs.command }}`, since no one can read it before the run
- a `shell` other than `bash`, `sh`, `pwsh`, `powershell` or `cmd`, set on the step or in `defaults.run.shell` of its job or workflow, since `shell: python` makes the `run` inline Python

A launcher, wrapper or program outside those sets is not judged.

An interpreter flag counts before the first operand, and the value of an option that takes one does not end the search.
So `bash -o pipefail -c 'bun install && bun test'` is refused, while `bun scripts/smoke-pack.ts -e staging` passes.
GitHub substitutes an expression into the script before the shell reads it, so an argument such as `${{ github.ref_name }}` passes and the operators inside the expression are not shell.

This step fails, because it appends through a redirect and spells its data with escapes:

```yaml
- name: Smoke names
  run: printf 'json={"names":["%b"]}\n' 'smoke\x2dpack\x2dterm' >> "$GITHUB_OUTPUT"
```

These steps pass:

```yaml
- uses: avi2d/workflows/actions/setup@v1
- name: Smoke names
  run: bun scripts/smoke-pack.ts
```

Each refusal names the file, the line of the `run` key when the check can locate it, the job and the step by its `name`, its `id` or its position, and each construct it found.

### Turning it on

The check is off until the repository sets `checks.plainSteps` to `true` in `package.json`:

```json
{
  "checks": { "plainSteps": true }
}
```

A repository turns it on in the pull request that cleans its workflows, so a kit release breaks no repository.
While it is off, it passes and says how to turn it on.

## What it reads

It reads `checks.plainSteps` from `package.json`.
When that is `true`, it reads each `*.yml` or `*.yaml` file directly under `.github/workflows/` and every `action.yml` or `action.yaml` in the working tree.
It lists them from the tracked and untracked files that `git ls-files --exclude-standard` reports, and passes over `node_modules/`, `repos/` and `tests/fixtures/`.
It parses each file with `Bun.YAML` without executing it, and reads the file's text for the line and layout of each `run` key.
It judges the `steps` of every job in a workflow and the `runs.steps` of a composite action.

## Arguments

```sh
checks-plain-steps [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the check is off, or every `run` step is one plain command |
| 1 | a `run` step holds more than one plain command |
| 2 | `package.json` or a workflow or action file cannot be read or parsed, or git does not list the working tree |

## Sample output

```
plain-steps: 2 run step(s) are not one plain command; run one command, or call a shared workflow or action that holds the logic:
  .github/workflows/ci.yml line 14 job smoke step "Smoke names": a backslash escape, a redirect
  .github/workflows/ci.yml line 17 job smoke step "Pack": a block scalar
```

## When it runs

`checks-lint` runs it in the full run in every repository, and it judges only a repository that turns it on.

## Related topics

- [checks-lint](checks-lint.md)
- [checks-ci-wiring](checks-ci-wiring.md)
- [Native settings](../configs/native-settings.md)
