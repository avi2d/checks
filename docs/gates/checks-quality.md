# checks-quality

`checks-quality` is the bin that writes what `quality.json` declares into generated fragments and workflows and checks them, and a reader looks it up when generated text is stale.

## What it checks

oxlint and tsc read their own JSON and nothing else, so `checks-quality generate` writes what `sources.effect` declares into two fragments at the repository root, and the hand-written configs extend them.
Both fragments are committed.

`oxlintrc.quality.json` holds one override: the declared paths as `files`, the exempt ones as `excludeFiles`, and the kit's Effect rule block, `presets/effect.oxlint.json`.
`tsconfig.quality.json` holds the language-service override: the same paths as `include`, the exempt ones as `exclude`, and `presets/effect.language-service.json`.
A kit release that changes a preset reaches the repository through its next `generate`.
A rule only this repository needs stays in its own `.oxlintrc.json`, whose overrides come after the fragment's and so win.

`.oxlintrc.json` extends its fragment:

```json
{
  "extends": ["./node_modules/@avi2dg/checks/oxlintrc.json", "./oxlintrc.quality.json"],
  "plugins": ["typescript", "oxc", "eslint", "import"]
}
```

`tsconfig.json` extends its fragment:

```json
{
  "extends": ["@avi2dg/checks/tsconfig.effect.json", "./tsconfig.quality.json"]
}
```

GitHub Actions reads its own YAML and nothing else, so `checks-quality generate` also writes the kit recipe workflows whole.
`.github/workflows/ci.yml` runs every `gates.ci` command but the title lint as its own step after a frozen install.
`.github/workflows/commitlint.yml` lints the pull request title with the installed kit config.
A step one repository alone needs lives in another workflow file, never in the recipe.
All generated workflows are committed.

`checks-quality --check` fails when any of these holds:

- A fragment is missing, or differs from what `generate` would write from `quality.json` and the installed kit's presets.
- A fragment is left over once `quality.json` stops declaring `sources.effect`.
- A generated workflow is missing, or differs from what `generate` would write from `quality.json` and the kit recipe.
- `.oxlintrc.json` or `tsconfig.json` does not list its fragment in `extends`, so the tool never reads it.
- `.oxlintrc.json` does not extend `./node_modules/@avi2dg/checks/oxlintrc.json`, so the kit's oxlint rules are not loaded.
- `tsconfig.json` does not extend `@avi2dg/checks/tsconfig.effect.json`, the one accepted spelling of the kit's Effect config.
- A `sources.effect.paths` or `sources.production` glob matches no tracked or untracked file, so it holds nothing.

Two details of the fragments are easy to get wrong, so the kit's tests pin both:

- A fragment sits at the repository root.
  oxlint resolves an override's `files`, and the language service an override's `include`, against the directory of the config holding it.
  From `.quality/` the language service reports no error at all on an `async function` planted under a declared path.
- The oxlint fragment always sets `plugins`, to the kit's.
  A config in `extends` that sets none brings in oxlint's default plugins, whose category rules then fire across the whole tree.
  The override names the kit's plugins beside the preset's `node`, `promise` and `unicorn`, because one that leaves any of the kit's out turns on the category rules of the plugins it adds under every declared path.

## What it reads

It reads the working tree: `quality.json`, the presets of the installed kit, `.oxlintrc.json`, `tsconfig.json`, the two fragments and the generated workflows.
It reads the root `package.json` name, since only the kit's own tree lints titles with its root `commitlint.config.js`.
The name also decides which kit configs `extends` must list, since the kit's own tree extends its root `oxlintrc.json` and `tsconfig.effect.json`.
It looks for `.bun-version`, and the suite pins its bun to that file when the file exists.
It lists the tracked and untracked files to see what each declared glob matches.

## Arguments

```sh
checks-quality generate
checks-quality --check
```

`generate` writes the fragments and the workflows, removes a left-over one, then runs the same check as `--check`.
`--check` writes nothing.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the generated files hold what `quality.json` declares |
| 1 | a generated file is stale, missing or left over, a fragment is not extended, the kit's config is not extended, or a declared glob matches no file |
| 2 | `quality.json` does not decode, or the arguments are neither `generate` nor `--check` |

## Sample output

```
checks-quality: 2 problem(s) with what quality.json declares:
  oxlintrc.quality.json is stale against quality.json and the kit's presets; run checks-quality generate
  tsconfig.json does not extend ./tsconfig.quality.json, so the language service never reads it
```

A passing run says what the generated files hold:

```
checks-quality: oxlintrc.quality.json and tsconfig.quality.json and .github/workflows/ci.yml and .github/workflows/commitlint.yml hold what quality.json declares
```

A stale workflow is reported the same way as a stale fragment.

## Opting out

It runs only in a repository that tracks `quality.json`, and a selection in `quality.json` always keeps it, since the file it sits in is what makes it apply.
A repository that declares no `sources.effect` gets no fragment, and the check then refuses a left-over one.
Every repository gets the title lint workflow, and one with `gates.ci` gets the suite with it.

## Related topics

- [The quality file](../configs/quality-file.md)
- [The Effect rules](../configs/effect-rules.md)
- [checks-lint](checks-lint.md)
