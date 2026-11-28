import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { isRecord } from "../../../src/delivery/workflow-references.ts";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo } from "../lib/fixture-repo.ts";

const WORKFLOWS = join(CHECKOUT, "src", "delivery", "workflows.ts");
const WIRING = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");
const SETUP = join(CHECKOUT, "src", "delivery", "setup.ts");
const FLAKE = ".github/workflows/flake.yml";
const CRON = "23 5 * * MON,THU";
const CONFIG = `export default { workflows: { flakeCron: "${CRON}" } };\n`;
const BUN_VERSION = await Bun.file(join(CHECKOUT, ".bun-version")).text();
const open = fixtureRepos("checks-workflows-flake-");

async function consumer(files: Readonly<Record<string, string>>) {
  const repo = await open({ "package.json": '{"name":"acme","private":true}', "CHANGELOG.md": "# Changelog\n", ".bun-version": BUN_VERSION, ...files });
  await repo.commit("start");
  return repo;
}

const workflowText = (repo: FixtureRepo) => Bun.file(join(repo.dir, FLAKE)).text();
const write = (repo: FixtureRepo) => ran($`bun ${WORKFLOWS} --write`.cwd(repo.dir).env(withoutPullRequestEvent()));
const wiring = (repo: FixtureRepo) => ran($`bun ${WIRING}`.cwd(repo.dir).env(withoutPullRequestEvent()));

async function events(repo: FixtureRepo): Promise<unknown> {
  const workflow: unknown = Bun.YAML.parse(await workflowText(repo));
  return isRecord(workflow) ? workflow["on"] : undefined;
}

test("flakeCron writes a schedule even when flake.yml is absent, keeps dispatch, and passes ci-wiring", async () => {
  const repo = await consumer({ "checks.config.ts": CONFIG });

  expect((await write(repo)).exitCode).toBe(0);
  expect(await events(repo)).toEqual({ workflow_dispatch: null, schedule: [{ cron: CRON }] });
  expect(await wiring(repo)).toEqual({ exitCode: 0, text: "ci-wiring: .github/workflows holds the set checks-workflows writes, so the set runs every gate\n" });
}, 30_000);

test.each([
  { command: WORKFLOWS, args: [], exitCode: 2 },
  { command: WORKFLOWS, args: ["--write"], exitCode: 2 },
  { command: WIRING, args: [], exitCode: 1 },
  { command: SETUP, args: [], exitCode: 2 },
])("rejects flakeCron that would start every five minutes through %j", async ({ command, args, exitCode }) => {
  const flake = 'name: flake\non:\n  workflow_dispatch:\n  schedule:\n    - cron: "*/5 * * * *"\n';
  const repo = await consumer({ "checks.config.ts": 'export default { workflows: { flakeCron: "*/5 * * * *" } };\n', [FLAKE]: flake });

  const result = await ran($`bun ${command} ${args}`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(result.exitCode).toBe(exitCode);
  expect(result.text).toContain("checks.config.ts key workflows.flakeCron does not decode");
  expect(result.text).toContain("at most once a day");
  expect(await workflowText(repo)).toBe(flake);
}, 30_000);

test.each(["23 5 * * *", "23 5 * * 1"])("daily limit does not block writing and checking %s", async (cron) => {
  const repo = await consumer({ "checks.config.ts": `export default { workflows: { flakeCron: "${cron}" } };\n` });

  expect((await write(repo)).exitCode).toBe(0);
  expect(await events(repo)).toEqual({ workflow_dispatch: null, schedule: [{ cron }] });
  expect((await ran($`bun ${WORKFLOWS}`.cwd(repo.dir).env(withoutPullRequestEvent()))).exitCode).toBe(0);
  expect((await wiring(repo)).exitCode).toBe(0);
}, 30_000);

test.each([
  ["23 5 0 * *", "day-of-month"],
  ["23 5 32 * *", "day-of-month"],
  ["23 5 8-2 * *", "day-of-month"],
  ["23 5 */0 * *", "day-of-month"],
  ["23 5 * 0 *", "month"],
  ["23 5 * 13 *", "month"],
  ["23 5 * JAN-XYZ *", "month"],
  ["23 5 * * 7", "weekday"],
  ["23 5 * * MON,,FRI", "weekday"],
  ["23 5 * * FUNDAY", "weekday"],
])("rejects invalid cron %s in the %s field", async (cron, field) => {
  const repo = await consumer({ "checks.config.ts": `export default { workflows: { flakeCron: "${cron}" } };\n` });
  const result = await write(repo);
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("checks.config.ts key workflows.flakeCron does not decode");
  expect(result.text).toContain(`invalid ${field} field`);
}, 30_000);

test.each(["23 5 1,15 1-12/2 0-6/2", "23 5 */2 JAN,MAR-DEC MON-FRI", "23 5 31 DEC SAT"])("writes valid cron %s", async (cron) => {
  const repo = await consumer({ "checks.config.ts": `export default { workflows: { flakeCron: "${cron}" } };\n` });
  expect((await write(repo)).exitCode).toBe(0);
  expect(await events(repo)).toEqual({ workflow_dispatch: null, schedule: [{ cron }] });
}, 30_000);

test("without flakeCron ci-wiring rejects a hand-added flake schedule and --write restores dispatch-only", async () => {
  const repo = await consumer({ [FLAKE]: `name: flake\non:\n  workflow_dispatch:\n  schedule:\n    - cron: "${CRON}"\n` });

  const result = await wiring(repo);
  expect(result.exitCode).toBe(1);
  expect(result.text).toContain("ci-wiring: 1 workflow(s) run on a schedule:");
  expect(result.text).toContain(`  ${FLAKE} line 4: drop the schedule`);
  expect((await write(repo)).exitCode).toBe(0);
  expect(await events(repo)).toEqual({ workflow_dispatch: null });
}, 30_000);

test("flakeCron does not exempt an edited flake job or a copy under another path from the schedule policy", async () => {
  const repo = await consumer({ "checks.config.ts": CONFIG });
  expect((await write(repo)).exitCode).toBe(0);
  const flake = await workflowText(repo);
  const edited = flake.replace("jobs:\n", "jobs:\n  extra:\n    runs-on: ubuntu-latest\n    timeout-minutes: 1\n    steps:\n      - run: echo extra\n");
  await repo.write({ [FLAKE]: edited, ".github/workflows/copy.yml": flake });

  const result = await wiring(repo);
  expect(result.exitCode).toBe(1);
  expect(result.text).toContain("ci-wiring: 2 workflow(s) run on a schedule:");
  expect(result.text).toContain(`  ${FLAKE} line 5: drop the schedule`);
  expect(result.text).toContain("  .github/workflows/copy.yml line 5: drop the schedule");
}, 30_000);
