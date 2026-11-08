import { SHARED_MUTATION } from "./mutation-workflow.ts";

const HOSTED_FALLBACK = "ubuntu-latest";
const HOSTED_DEFAULT = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";

export function ciWorkflow(isPrivate: boolean, hasBuild: boolean): string {
  const lines = [
    "name: ci",
    "",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize]",
    "",
    "concurrency:",
    "  group: ci-${{ github.event.pull_request.number }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  checks:",
    "    runs-on: " + (isPrivate ? HOSTED_DEFAULT : HOSTED_FALLBACK),
    "    timeout-minutes: 30",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: oven-sh/setup-bun@v2",
    "        with:",
    "          bun-version-file: .bun-version",
    "      - id: install",
    "        run: bun install --frozen-lockfile",
  ];
  if (hasBuild) {
    lines.push("      - run: bun run build", "      - run: git diff --exit-code");
  }
  // A step without a status function runs only after every earlier step succeeded, so a failed lint would skip both.
  const afterInstall = "      - if: ${{ !cancelled() && steps.install.outcome == 'success' }}";
  lines.push("      - run: bun run lint", afterInstall, "        run: bun run typecheck", afterInstall, "        run: bun run test");
  lines.push(
    "      - id: title",
    "        name: lint the title",
    "        env:",
    "          PR_TITLE: ${{ github.event.pull_request.title }}",
    "          GH_TOKEN: ${{ github.token }}",
    "        run: bunx checks-commit-title",
    "",
  );
  return lines.join("\n");
}

const MUTATE = ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"];

// A reusable workflow cannot filter the push that calls it, so the caller holds the baseline's path filter.
const BASELINE_PATHS = ["src/**", "tests/unit/**", "stryker.conf.mjs", "package.json", "bun.lock", ".bun-version", "bunfig.toml"];

const flow = (values: readonly string[]): string => "[" + values.map((value) => JSON.stringify(value)).join(", ") + "]";

// A schedule fails ci-wiring, so a refresh starts by hand.
export const MUTATION_WORKFLOW = [
  "name: mutation",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize]",
  "  push:",
  "    branches: [main]",
  "    paths: " + flow(BASELINE_PATHS),
  "  workflow_dispatch:",
  "    inputs:",
  "      mode: { type: choice, options: [baseline, refresh], default: baseline }",
  "",
  "jobs:",
  "  mutation:",
  "    uses: " + SHARED_MUTATION,
  "    permissions: { contents: read, actions: write, pull-requests: write }",
  "    with:",
  "      mode: ${{ github.event_name == 'pull_request' && 'compare' || inputs.mode || 'baseline' }}",
  "",
].join("\n");

export const STRYKER_CONFIG = [
  "import preset from \"@avi2dg/checks/stryker.preset.js\";",
  "",
  "export default { ...preset, mutate: " + flow(MUTATE) + " };",
  "",
].join("\n");
