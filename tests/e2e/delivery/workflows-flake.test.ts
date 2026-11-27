import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { isRecord } from "../../../src/delivery/workflow-references.ts";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo } from "../lib/fixture-repo.ts";

const WORKFLOWS = join(CHECKOUT, "src", "delivery", "workflows.ts");
const WIRING = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");
const FLAKE = ".github/workflows/flake.yml";
const CRON = "23 5 * * MON,THU";
const CONFIG = `export default { flakeCron: "${CRON}" };\n`;
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
