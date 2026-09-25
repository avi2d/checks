import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COMMITLINT_WORKFLOW, SUITE_WORKFLOW } from "../../scripts/quality.ts";
import { parseWorkflow, runs, setupBun } from "../lib/workflow.ts";
import { fixtureRepos } from "./lib/fixture-repo.ts";

const repository = fixtureRepos("checks-quality-workflows-");

const QUALITY = {
  $schema: "./node_modules/@avi2dg/checks/quality.schema.json",
  gates: { ci: ["bun run lint", "bun run typecheck", "./node_modules/.bin/commitlint"] },
};

test(
  "generate writes the kit-recipe workflows, --check holds them, and ci-wiring keeps checking them",
  async () => {
    const repo = await repository({
      "quality.json": JSON.stringify(QUALITY),
      "package.json": JSON.stringify({ name: "workflow-fixture", type: "module" }),
    });

    const generated = await repo.script("quality.ts", "generate");
    expect(generated.text).toContain(`wrote ${SUITE_WORKFLOW}`);
    expect(generated.text).toContain(`wrote ${COMMITLINT_WORKFLOW}`);
    expect(generated.exitCode).toBe(0);

    const suite = await readFile(join(repo.dir, SUITE_WORKFLOW), "utf8");
    const parsedSuite = parseWorkflow(suite);
    expect(runs(parsedSuite)).toEqual(["bun install --frozen-lockfile", "bun run lint", "bun run typecheck"]);
    expect(setupBun(parsedSuite)).toBeUndefined();
    const commitlint = parseWorkflow(await readFile(join(repo.dir, COMMITLINT_WORKFLOW), "utf8"));
    expect(runs(commitlint).at(-1)).toBe(
      './node_modules/.bin/commitlint --config ./node_modules/@avi2dg/checks/commitlint.config.js --edit "$RUNNER_TEMP/pr-title"',
    );
    expect(commitlint.on.pull_request.types).toEqual(["opened", "edited", "synchronize", "reopened"]);

    const wiring = await repo.script("ci-wiring.ts");
    expect(wiring.text).toContain("3 gate(s) run on pull requests to main");
    expect(wiring.exitCode).toBe(0);

    await writeFile(join(repo.dir, SUITE_WORKFLOW), `${suite}      - run: echo drift\n`);
    const red = await repo.script("quality.ts", "--check");
    expect(red.text).toContain(`${SUITE_WORKFLOW} is stale against quality.json and the kit recipe`);
    expect(red.exitCode).toBe(1);

    const green = await repo.script("quality.ts", "generate");
    expect(green.exitCode).toBe(0);
    expect(await readFile(join(repo.dir, SUITE_WORKFLOW), "utf8")).toBe(suite);
  },
  60_000,
);

test(
  "a consumer's root commitlint config never replaces the kit's, while the kit's own tree lints with its root config and its pinned bun",
  async () => {
    const repo = await repository({
      "quality.json": JSON.stringify(QUALITY),
      "package.json": JSON.stringify({ name: "workflow-fixture", type: "module" }),
      "commitlint.config.js": "export default {};\n",
      ".bun-version": "1.3.13\n",
    });
    const titleLint = async () => runs(parseWorkflow(await readFile(join(repo.dir, COMMITLINT_WORKFLOW), "utf8"))).at(-1);

    const consumer = await repo.script("quality.ts", "generate");
    expect(consumer.exitCode).toBe(0);
    expect(await titleLint()).toBe(
      './node_modules/.bin/commitlint --config ./node_modules/@avi2dg/checks/commitlint.config.js --edit "$RUNNER_TEMP/pr-title"',
    );

    await writeFile(join(repo.dir, "package.json"), JSON.stringify({ name: "@avi2dg/checks", type: "module" }));
    const kit = await repo.script("quality.ts", "generate");
    expect(kit.exitCode).toBe(0);
    expect(await titleLint()).toBe('./node_modules/.bin/commitlint --config ./commitlint.config.js --edit "$RUNNER_TEMP/pr-title"');
    expect(setupBun(parseWorkflow(await readFile(join(repo.dir, SUITE_WORKFLOW), "utf8")))).toEqual({ "bun-version-file": ".bun-version" });
  },
  60_000,
);

test(
  "with no gates.ci declared, neither generate nor --check touches the repository's own ci.yml",
  async () => {
    const own = "on: push\njobs:\n  own:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n";
    const repo = await repository({
      "quality.json": JSON.stringify({ $schema: QUALITY.$schema }),
      "package.json": JSON.stringify({ name: "workflow-fixture", type: "module" }),
      [SUITE_WORKFLOW]: own,
    });

    const generated = await repo.script("quality.ts", "generate");
    expect(generated.text).not.toContain(SUITE_WORKFLOW);
    expect(generated.exitCode).toBe(0);
    expect(await readFile(join(repo.dir, SUITE_WORKFLOW), "utf8")).toBe(own);

    const checked = await repo.script("quality.ts", "--check");
    expect(checked.text).not.toContain(SUITE_WORKFLOW);
    expect(checked.exitCode).toBe(0);
    expect(await readFile(join(repo.dir, SUITE_WORKFLOW), "utf8")).toBe(own);
  },
  60_000,
);
