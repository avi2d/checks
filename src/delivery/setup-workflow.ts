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

const flow = (values: readonly string[]): string => "[" + values.map((value) => JSON.stringify(value)).join(", ") + "]";

// The shared workflow picks the run from the event, so the caller names it and nothing else.
// A manual start of this workflow runs a refresh; no run starts after a merge to main.
export const MUTATION_WORKFLOW = [
  "name: mutation",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize]",
  "  workflow_dispatch:",
  "",
  "jobs:",
  "  mutation:",
  "    uses: " + SHARED_MUTATION,
  "    permissions: { contents: read, actions: write, pull-requests: write }",
  "",
].join("\n");

export const STRYKER_CONFIG = [
  "import preset from \"@avi2dg/checks/stryker.preset.js\";",
  "",
  "export default { ...preset, mutate: " + flow(MUTATE) + " };",
  "",
].join("\n");
