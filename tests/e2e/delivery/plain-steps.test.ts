import { expect, test } from "bun:test";
import { fixtureRepos } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-plain-steps-");

const PRINTF_STEP = String.raw`printf 'json={"names":["%b"]}\n' 'smoke\x2dpack\x2dterm' >> "$GITHUB_OUTPUT"`;

const workflow = (steps: readonly string[]): string =>
  ["name: smoke", "on: pull_request", "jobs:", "  smoke:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:", ...steps, ""].join("\n");

test(
  "passes while off, then refuses the redirect and the block scalar once turned on, and passes once each step is one command",
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

    const off = await script("delivery/plain-steps.ts");
    expect(off.exitCode).toBe(0);
    expect(off.text).toContain("plain-steps: off; set checks.plainSteps to true in package.json to turn it on\n");

    await write({ "package.json": JSON.stringify({ name: "plain-steps-fixture", type: "module", checks: { plainSteps: true } }) });
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
