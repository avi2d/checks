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
    "    steps:",
    "      - uses: actions/checkout@v5",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: oven-sh/setup-bun@v2",
    "        with:",
    "          bun-version-file: .bun-version",
    "      - run: bun install --frozen-lockfile",
  ];
  if (hasBuild) {
    lines.push("      - run: bun run build", "      - run: git diff --exit-code");
  }
  lines.push("      - run: bun run lint", "      - run: bun run typecheck", "      - run: bun run test");
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
