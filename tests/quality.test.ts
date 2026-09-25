import { expect, test } from "bun:test";
import effectLanguageService from "../presets/effect.language-service.json" with { type: "json" };
import effectOxlint from "../presets/effect.oxlint.json" with { type: "json" };
import { fragmentsFor, OXLINT_FRAGMENT, suiteWorkflow, TSCONFIG_FRAGMENT, workflowsFor } from "../scripts/quality.ts";
import { parseWorkflow, runs, setupBun } from "./lib/workflow.ts";

test("without sources.effect there is nothing to generate", () => {
  expect(fragmentsFor({})).toEqual([]);
  expect(fragmentsFor({ sources: { production: ["src/**/*.ts"] } })).toEqual([]);
});

test("each fragment holds the declared paths under the kit's presets, and the exempt files outside them", () => {
  const [oxlint, tsconfig] = fragmentsFor({ sources: { effect: { paths: ["src/**/*.ts"], exempt: ["src/host/*.ts"] } } });
  expect(oxlint).toEqual({
    file: OXLINT_FRAGMENT,
    extendedBy: ".oxlintrc.json",
    reader: "oxlint",
    content: {
      $schema: "./node_modules/oxlint/configuration_schema.json",
      plugins: ["typescript", "oxc", "eslint", "import"],
      overrides: [
        {
          files: ["src/**/*.ts"],
          excludeFiles: ["src/host/*.ts"],
          plugins: ["typescript", "oxc", "eslint", "import", "node", "promise", "unicorn"],
          rules: effectOxlint.rules,
        },
      ],
    },
  });
  expect(tsconfig).toEqual({
    file: TSCONFIG_FRAGMENT,
    extendedBy: "tsconfig.json",
    reader: "the language service",
    content: {
      compilerOptions: {
        plugins: [
          {
            name: "@effect/language-service",
            overrides: [
              { include: ["src/**/*.ts"], exclude: ["src/host/*.ts"], options: effectLanguageService },
            ],
          },
        ],
      },
    },
  });

  const [unexempt] = fragmentsFor({ sources: { effect: { paths: ["src/**/*.ts"] } } });
  expect(JSON.stringify(unexempt?.content)).not.toContain("excludeFiles");
});

const KIT_CONFIG = "./node_modules/@avi2dg/checks/commitlint.config.js";
const INSTALL = "bun install --frozen-lockfile";
const TITLE_LINT = `./node_modules/.bin/commitlint --config ${KIT_CONFIG} --edit "$RUNNER_TEMP/pr-title"`;

test("the suite workflow runs the declared gates in order after a frozen install, on pushes to the default branch", () => {
  const workflow = parseWorkflow(suiteWorkflow("main", ["bun run build", "git diff --exit-code", "bun run lint"], true));
  expect(workflow.on.push?.branches).toEqual(["main"]);
  expect(setupBun(workflow)).toEqual({ "bun-version-file": ".bun-version" });
  expect(runs(workflow)).toEqual([INSTALL, "bun run build", "git diff --exit-code", "bun run lint"]);

  const unpinned = parseWorkflow(suiteWorkflow("next", ["bun run lint"], false));
  expect(unpinned.on.push?.branches).toEqual(["next"]);
  expect(setupBun(unpinned)).toBeUndefined();
});

test("a gate no plain step can carry still reaches the runner as the exact command", () => {
  expect(runs(parseWorkflow(suiteWorkflow("main", ["echo a: b", "# not a comment"], false)))).toEqual([
    INSTALL,
    "echo a: b",
    "# not a comment",
  ]);
});

test("workflowsFor routes a gate the title lint runs to its own workflow and keeps every other gate in the suite", () => {
  const recipe = { commitlintConfig: KIT_CONFIG, bunVersionFile: false };
  const [suite, commitlint] = workflowsFor({ gates: { ci: ["bun run lint", "./node_modules/.bin/commitlint"] } }, recipe);
  expect(suite?.file).toBe(".github/workflows/ci.yml");
  expect(runs(parseWorkflow(suite?.content ?? ""))).toEqual([INSTALL, "bun run lint"]);
  expect(commitlint?.file).toBe(".github/workflows/commitlint.yml");
  const titleLint = parseWorkflow(commitlint?.content ?? "");
  expect(titleLint.on.pull_request.types).toEqual(["opened", "edited", "synchronize", "reopened"]);
  expect(runs(titleLint).at(-1)).toBe(TITLE_LINT);
  for (const workflow of [suite, commitlint]) expect(Bun.YAML.parse(workflow?.content ?? "")).not.toHaveProperty("permissions");

  const unrun = ["commitlint", "node_modules/.bin/commitlint", "./node_modules/.bin/commitlint --from origin/main --to HEAD"] as const;
  const [kept] = workflowsFor({ gates: { ci: unrun } }, recipe);
  expect(runs(parseWorkflow(kept?.content ?? ""))).toEqual([INSTALL, ...unrun]);
});

test("without gates.ci only the title lint is generated", () => {
  const generated = workflowsFor({}, { commitlintConfig: "./commitlint.config.js", bunVersionFile: true });
  expect(generated.map((workflow) => workflow.file)).toEqual([".github/workflows/commitlint.yml"]);
  expect(runs(parseWorkflow(generated[0]?.content ?? "")).at(-1)).toBe(
    './node_modules/.bin/commitlint --config ./commitlint.config.js --edit "$RUNNER_TEMP/pr-title"',
  );
});
