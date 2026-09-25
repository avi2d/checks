import { expect, test } from "bun:test";
import effectLanguageService from "../presets/effect.language-service.json" with { type: "json" };
import effectOxlint from "../presets/effect.oxlint.json" with { type: "json" };
import { fragmentsFor, isCommitlintGate, OXLINT_FRAGMENT, suiteWorkflow, TSCONFIG_FRAGMENT, workflowsFor } from "../scripts/quality.ts";

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

test("a commitlint gate is the binary name whatever directory runs it", () => {
  expect(isCommitlintGate("./node_modules/.bin/commitlint")).toBe(true);
  expect(isCommitlintGate("./node_modules/.bin/commitlint --config ./commitlint.config.js --edit x")).toBe(true);
  expect(isCommitlintGate("bun run lint")).toBe(false);
  expect(isCommitlintGate("bunx checks-flake --runs 10")).toBe(false);
});

test("the suite workflow runs the declared gates after a frozen install, and routes the title lint to its own workflow", () => {
  const workflow = suiteWorkflow("main", ["bun run build", "git diff --exit-code", "bun run lint"], true);
  expect(workflow).toContain("branches: [main]");
  expect(workflow).toContain("bun-version-file: .bun-version");
  expect(workflow).toContain("      - run: bun install --frozen-lockfile\n      - run: bun run build\n");
  expect(workflow).not.toContain("commitlint");
  expect(Bun.YAML.parse(workflow)).toBeDefined();

  const unpinned = suiteWorkflow("next", ["bun run lint"], false);
  expect(unpinned).toContain("branches: [next]");
  expect(unpinned).not.toContain("bun-version-file");
  expect(Bun.YAML.parse(unpinned)).toBeDefined();
});

test("a gate no plain step can carry is quoted rather than emitted bare", () => {
  const workflow = suiteWorkflow("main", ["echo a: b"], false);
  expect(workflow).toContain('      - run: "echo a: b"\n');
  expect(Bun.YAML.parse(workflow)).toBeDefined();
});

test("workflowsFor writes the suite from gates.ci and always the title lint", () => {
  const recipe = { commitlintConfig: "./node_modules/@avi2dg/checks/commitlint.config.js", bunVersionFile: false };
  const [suite, commitlint] = workflowsFor(
    { gates: { ci: ["bun run lint", "./node_modules/.bin/commitlint"] } },
    recipe,
  );
  expect(suite?.file).toBe(".github/workflows/ci.yml");
  expect(suite?.content).toContain("      - run: bun run lint\n");
  expect(suite?.content).not.toContain("./node_modules/.bin/commitlint");
  expect(commitlint?.file).toBe(".github/workflows/commitlint.yml");
  expect(commitlint?.content).toContain("--config ./node_modules/@avi2dg/checks/commitlint.config.js");
  expect(Bun.YAML.parse(commitlint?.content ?? "")).toBeDefined();
});

test("without gates.ci only the title lint is generated", () => {
  const [only] = workflowsFor({}, { commitlintConfig: "./commitlint.config.js", bunVersionFile: true });
  expect(only?.file).toBe(".github/workflows/commitlint.yml");
  expect(only?.content).toContain("--config ./commitlint.config.js");
});
