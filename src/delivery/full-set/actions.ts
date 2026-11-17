import { type CallerSet } from "../site-names.ts";
import { SETUP_BUN, CACHE, type Pair, expression, stepLines } from "./steps.ts";

export type RepositoryFile = { readonly path: string; readonly text: string };

export const SETUP_ACTION = ".github/actions/setup/action.yml";
const BUN_WITHOUT_UNZIP = ".github/actions/setup/bun-without-unzip.sh";
const PLAYWRIGHT_ACTION = ".github/actions/playwright/action.yml";

export const ACTION_FILES = [SETUP_ACTION, BUN_WITHOUT_UNZIP, PLAYWRIGHT_ACTION] as const;

const SETUP_ACTION_TEXT = [
  "name: setup",
  "description: Installs the Bun that .bun-version pins and the locked dependencies, after the job checks out the repository.",
  "runs:",
  "  using: composite",
  "  steps:",
  ...stepLines({ name: "fetch Bun through npm where the image holds no unzip", shell: "bash", run: "bash " + BUN_WITHOUT_UNZIP }, "    "),
  ...stepLines({ uses: SETUP_BUN, with: [["bun-version-file", ".bun-version"]] }, "    "),
  ...stepLines(
    {
      note: "A self-hosted runner keeps its Bun cache between jobs, where a restore only adds time.",
      if: "runner.environment == 'github-hosted'",
      uses: CACHE,
      with: [
        ["path", "~/.bun/install/cache"],
        ["key", "bun-" + expression("runner.os") + "-" + expression("hashFiles('bun.lock')")],
        ["restore-keys", "bun-" + expression("runner.os") + "-"],
      ],
    },
    "    ",
  ),
  ...stepLines({ name: "install the locked dependencies", shell: "bash", run: "bun install --frozen-lockfile" }, "    "),
  "",
].join("\n");

const BUN_WITHOUT_UNZIP_TEXT = [
  "#!/usr/bin/env bash",
  "# setup-bun unpacks its download with unzip, and keeps a Bun of the pinned version that it finds at ~/.bun/bin/bun.",
  "set -euo pipefail",
  "",
  "if command -v unzip > /dev/null; then",
  "  exit 0",
  "fi",
  "if ! command -v npm > /dev/null; then",
  '  echo "::error::setup found no unzip for setup-bun, and no npm to fetch Bun without it"',
  "  exit 1",
  "fi",
  "",
  'version="$(< .bun-version)"',
  'prefix="$RUNNER_TEMP/bun-from-npm"',
  'package="$prefix/node_modules/bun"',
  "# npm leaves a placeholder at bin/bun.exe, and an npm that holds install scripts back never swaps the binary in.",
  'npm install --ignore-scripts --prefix "$prefix" "bun@${version#v}"',
  'node "$package/install.js"',
  'install -D "$package/bin/bun.exe" "$HOME/.bun/bin/bun"',
  '"$HOME/.bun/bin/bun" --version',
  "",
].join("\n");

const BROWSERS: Pair = ["BROWSERS", expression("inputs.browsers")];

const PLAYWRIGHT_ACTION_TEXT = [
  "name: playwright",
  "description: Installs the browser builds and the system packages the locked playwright-core needs.",
  "inputs:",
  "  browsers:",
  "    description: The browsers to install, separated by spaces, such as webkit.",
  "    required: true",
  "runs:",
  "  using: composite",
  "  steps:",
  ...stepLines(
    {
      note: "A self-hosted runner keeps its browsers between jobs, where a restore only adds time.",
      if: "runner.environment == 'github-hosted'",
      uses: CACHE,
      with: [
        ["path", "~/.cache/ms-playwright"],
        ["key", "playwright-" + expression("inputs.browsers") + "-" + expression("runner.os") + "-" + expression("hashFiles('bun.lock')")],
      ],
    },
    "    ",
  ),
  ...stepLines({ name: "install the browsers", shell: "bash", env: [BROWSERS], run: "bunx checks-ci playwright install" }, "    "),
  ...stepLines(
    {
      note: "Self-hosted runners already hold system packages, and installing them there needs root.",
      name: "install the system packages the machine does not hold",
      if: "runner.environment == 'github-hosted'",
      shell: "bash",
      env: [BROWSERS],
      run: "bunx checks-ci playwright install-deps",
    },
    "    ",
  ),
  "",
].join("\n");

export function fullActions(set: CallerSet): readonly RepositoryFile[] {
  const setup = [
    { path: SETUP_ACTION, text: SETUP_ACTION_TEXT },
    { path: BUN_WITHOUT_UNZIP, text: BUN_WITHOUT_UNZIP_TEXT },
  ];
  const browsers = set.kind === "site" || set.ci.tests.some((test) => test.browsers !== "");
  return browsers ? [...setup, { path: PLAYWRIGHT_ACTION, text: PLAYWRIGHT_ACTION_TEXT }] : setup;
}
