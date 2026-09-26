import { expect, test } from "bun:test";
import effectLanguageService from "../presets/effect.language-service.json" with { type: "json" };
import effectOxlint from "../presets/effect.oxlint.json" with { type: "json" };
import { commitlintWorkflow, fragmentsFor, OXLINT_FRAGMENT, suiteWorkflow, TSCONFIG_FRAGMENT, workflowsFor } from "../scripts/quality.ts";
import { lastStep, parseWorkflow, runs, runsOn, setupBun, setupNode } from "./lib/workflow.ts";

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
const TITLE_LINT = `bun run ./node_modules/.bin/commitlint --config ${KIT_CONFIG} --edit "$RUNNER_TEMP/pr-title"`;

test("the suite workflow runs the declared gates in order after a frozen install, on pushes to the default branch", () => {
  const workflow = parseWorkflow(suiteWorkflow("main", ["bun run build", "git diff --exit-code", "bun run lint"], true, false, undefined));
  expect(workflow.on.push?.branches).toEqual(["main"]);
  expect(setupBun(workflow)).toEqual({ "bun-version-file": ".bun-version" });
  expect(setupNode(workflow)).toBeUndefined();
  expect(runs(workflow)).toEqual([INSTALL, "bun run build", "git diff --exit-code", "bun run lint"]);

  const unpinned = parseWorkflow(suiteWorkflow("next", ["bun run lint"], false, false, undefined));
  expect(unpinned.on.push?.branches).toEqual(["next"]);
  expect(setupBun(unpinned)).toBeUndefined();
});

test("a .node-version at the repository root pins the suite's node before bun install", () => {
  const workflow = parseWorkflow(suiteWorkflow("main", ["bun run test"], false, true, undefined));
  expect(setupNode(workflow)).toEqual({ "node-version-file": ".node-version" });
  expect(runs(workflow)).toEqual([INSTALL, "bun run test"]);

  const unpinned = parseWorkflow(suiteWorkflow("main", ["bun run test"], false, false, undefined));
  expect(setupNode(unpinned)).toBeUndefined();
});

test("a gate no plain step can carry still reaches the runner as the exact command", () => {
  expect(runs(parseWorkflow(suiteWorkflow("main", ["echo a: b", "# not a comment"], false, false, undefined)))).toEqual([
    INSTALL,
    "echo a: b",
    "# not a comment",
  ]);
});

test("runs-on is ubuntu-latest when quality.json declares none, or else the declared list of labels", () => {
  const suite = parseWorkflow(suiteWorkflow("main", ["bun run lint"], false, false, undefined));
  expect(runsOn(suite)).toBe("ubuntu-latest");
  const commitlint = parseWorkflow(commitlintWorkflow(KIT_CONFIG, undefined));
  expect(runsOn(commitlint)).toBe("ubuntu-latest");

  const labelled = parseWorkflow(suiteWorkflow("main", ["bun run lint"], false, false, ["self-hosted"]));
  expect(runsOn(labelled)).toEqual(["self-hosted"]);

  const labels = ["self-hosted", "Linux", "X64", "winbox"] as const;
  const listed = parseWorkflow(suiteWorkflow("main", ["bun run lint"], false, false, labels));
  expect(runsOn(listed)).toEqual(labels);
  const listedCommitlint = parseWorkflow(commitlintWorkflow(KIT_CONFIG, labels));
  expect(runsOn(listedCommitlint)).toEqual(labels);
});

test("workflowsFor routes a gate the title lint runs to its own workflow and keeps every other gate in the suite", () => {
  const recipe = { commitlintConfig: KIT_CONFIG, bunVersionFile: false, nodeVersionFile: false };
  const [suite, commitlint] = workflowsFor({ gates: { ci: ["bun run lint", "./node_modules/.bin/commitlint"] } }, recipe);
  expect(suite?.file).toBe(".github/workflows/ci.yml");
  expect(runs(parseWorkflow(suite?.content ?? ""))).toEqual([INSTALL, "bun run lint"]);
  expect(commitlint?.file).toBe(".github/workflows/commitlint.yml");
  const titleLint = parseWorkflow(commitlint?.content ?? "");
  expect(titleLint.on.pull_request.types).toEqual(["opened", "edited", "synchronize", "reopened"]);
  expect(runs(titleLint).at(-1)).toBe(TITLE_LINT);
  expect(Bun.YAML.parse(suite?.content ?? "")).not.toHaveProperty("permissions");
  expect(Bun.YAML.parse(commitlint?.content ?? "")).toHaveProperty("permissions", { contents: "read" });

  const unrun = ["commitlint", "node_modules/.bin/commitlint", "./node_modules/.bin/commitlint --from origin/main --to HEAD"] as const;
  const [kept] = workflowsFor({ gates: { ci: unrun } }, recipe);
  expect(runs(parseWorkflow(kept?.content ?? ""))).toEqual([INSTALL, ...unrun]);
});

test("a label carrying a flow indicator stays one label in the runs-on list", () => {
  const labels = ["self-hosted", "${{ vars.RUNNER }}", "a,b", "x[y]"] as const;
  expect(runsOn(parseWorkflow(suiteWorkflow("main", ["bun run lint"], false, false, labels)))).toEqual(labels);
  expect(runsOn(parseWorkflow(commitlintWorkflow(KIT_CONFIG, labels)))).toEqual(labels);
});

test("workflowsFor carries quality.json's runsOn onto both the suite and the commitlint job", () => {
  const recipe = { commitlintConfig: KIT_CONFIG, bunVersionFile: false, nodeVersionFile: false };
  const labels = ["self-hosted", "Linux", "X64", "winbox"] as const;
  const [suite, commitlint] = workflowsFor({ gates: { ci: ["bun run lint"] }, runsOn: labels }, recipe);
  expect(runsOn(parseWorkflow(suite?.content ?? ""))).toEqual(labels);
  expect(runsOn(parseWorkflow(commitlint?.content ?? ""))).toEqual(labels);
});

test("the title lint step moves git's comment character off '#' so a title starting with it still lints", () => {
  const commitlint = parseWorkflow(commitlintWorkflow(KIT_CONFIG, undefined));
  expect(lastStep(commitlint).env).toEqual({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.commentChar",
    GIT_CONFIG_VALUE_0: "\x01",
  });
});

test("without gates.ci only the title lint is generated", () => {
  const generated = workflowsFor({}, { commitlintConfig: "./commitlint.config.js", bunVersionFile: true, nodeVersionFile: false });
  expect(generated.map((workflow) => workflow.file)).toEqual([".github/workflows/commitlint.yml"]);
  expect(runs(parseWorkflow(generated[0]?.content ?? "")).at(-1)).toBe(
    'bun run ./node_modules/.bin/commitlint --config ./commitlint.config.js --edit "$RUNNER_TEMP/pr-title"',
  );
});

test("a label or gate YAML would read as a null, a boolean or a number stays the same string", () => {
  const labels = ["null", "~", "true", "False", "yes", "off", "123", "-7", "0x1F", "0o17", "1.5", ".5", "1e3", ".inf", "-.Inf", ".NaN"] as const;
  expect(runsOn(parseWorkflow(suiteWorkflow("main", labels, false, false, labels)))).toEqual(labels);
  expect(runs(parseWorkflow(suiteWorkflow("main", labels, false, false, undefined)))).toEqual([INSTALL, ...labels]);
  expect(runsOn(parseWorkflow(commitlintWorkflow(KIT_CONFIG, labels)))).toEqual(labels);
});
