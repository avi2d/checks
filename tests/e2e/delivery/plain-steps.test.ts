import { expect, test } from "bun:test";
import { fixtureRepos } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-plain-steps-");

const PRINTF_STEP = String.raw`printf 'json={"names":["%b"]}\n' 'smoke\x2dpack\x2dterm' >> "$GITHUB_OUTPUT"`;

const workflow = (steps: readonly string[]): string =>
  ["name: smoke", "on: pull_request", "jobs:", "  smoke:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:", ...steps, ""].join("\n");

test(
  "refuses a redirect and block scalar without a manifest switch, then passes plain commands",
  async () => {
    const { write, commit, script } = await open({
      "package.json": JSON.stringify({ name: "plain-steps-fixture", type: "module" }),
      ".github/workflows/smoke.yml": workflow([
        "      - uses: avi2d/workflows/actions/setup@v1",
        "      - name: Smoke names",
        `        run: ${PRINTF_STEP}`,
        "      - name: Pack",
        "        run: |",
        "          bun scripts/smoke-pack.ts",
      ]),
    });
    await commit("feat: base");

    const red = await script("delivery/plain-steps.ts");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(
      [
        "plain-steps: 2 run step(s) are not one plain command; run one command, or call a shared workflow or action that holds the logic:",
        '  .github/workflows/smoke.yml line 10 job smoke step "Smoke names": a backslash escape, a redirect',
        '  .github/workflows/smoke.yml line 12 job smoke step "Pack": a block scalar',
        "",
      ].join("\n"),
    );

    await write({
      ".github/workflows/smoke.yml": workflow([
        "      - uses: avi2d/workflows/actions/setup@v1",
        "      - name: Pack",
        "        run: bun scripts/smoke-pack.ts",
      ]),
    });
    const green = await script("delivery/plain-steps.ts");
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("plain-steps: every run step in 1 workflow or action file(s) is one plain command\n");
  },
  120_000,
);

test(
  "passes a reusable workflow and a composite action that run the caller's command, and refuses the same run in an ordinary workflow",
  async () => {
    const { write, commit, script } = await open({
      "package.json": JSON.stringify({ name: "plain-steps-fixture", type: "module" }),
      ".github/workflows/release.yml": ["name: release", "on:", "  workflow_call:", "    inputs:", "      publish-command:", "        type: string", "jobs:", "  publish:", "    runs-on: ubuntu-latest", "    steps:", "      - run: ${{ inputs.publish-command }}", ""].join("\n"),
      "actions/slot/action.yml": [
        "name: slot",
        "inputs:",
        "  action:",
        "    required: true",
        "  command:",
        "    required: true",
        "runs:",
        "  using: composite",
        "  steps:",
        "    - shell: bash",
        "      env:",
        "        ACTION: ${{ inputs.action }}",
        "        COMMAND: ${{ inputs.command }}",
        `      run: '"$COMMAND" "$ACTION"'`,
        "",
      ].join("\n"),
    });
    await commit("feat: base");

    const green = await script("delivery/plain-steps.ts");
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("plain-steps: every run step in 2 workflow or action file(s) is one plain command\n");

    await write({ ".github/workflows/smoke.yml": workflow(["      - run: ${{ inputs.publish-command }}"]) });
    const red = await script("delivery/plain-steps.ts");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("  .github/workflows/smoke.yml line 8 job smoke step 1: a command named only at run time\n");
  },
  120_000,
);
