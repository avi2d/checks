import { expect, test } from "bun:test";
import { callerOptionsOf, NO_CALLER_OPTIONS, readsPublishWorkspaces } from "../../../src/delivery/caller-options.ts";
import type { Workflow } from "../../../src/delivery/workflow-references.ts";

const workflow = (name: string, text: string): Workflow => ({ path: `.github/workflows/${name}`, document: Bun.YAML.parse(text), text });

const optionsOf = (files: Readonly<Record<string, string>>, publishes = false, publishWorkspaces = false, needsReleaseChecks = false) =>
  callerOptionsOf((name) => {
    const text = files[name];
    return text === undefined ? undefined : workflow(name, text);
  }, publishes, publishWorkspaces, needsReleaseChecks);

const HAND_ROLLED_DOCS = [
  "name: docs",
  "on:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: avi2d/workflows/setup@v1",
  "      - uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0",
  "      - run: bun run docs:build",
  "      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0",
  "        with:",
  "          path: docs/.vitepress/dist",
  "  deploy:",
  "    needs: build",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - id: deployment",
  "        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1",
  "",
].join("\n");

const HAND_ROLLED_FLAKE = [
  "name: flake",
  "on:",
  "  workflow_dispatch:",
  "jobs:",
  "  flake:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: avi2d/workflows/setup@v1",
  "      - uses: actions/setup-node@v7",
  "        with:",
  "          node-version-file: .node-version",
  "      - run: bunx checks-flake --runs 10 --report flake-report.json",
  "",
].join("\n");

const SINGLE_JOB_CI_WITH_PACK = [
  "name: ci",
  "on:",
  "  pull_request:",
  "jobs:",
  "  checks:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: avi2d/workflows/setup@v1",
  "      - uses: avi2d/workflows/actions/secrets-pack@v2",
  "        with:",
  "          pack: ${{ secrets.CHECKS_SECRETS_PACK }}",
  "      - run: bun run lint",
  "",
].join("\n");

test("a repository that holds none of the optional pieces gets no option, so its callers stay the ones every repository gets", () => {
  expect(optionsOf({})).toEqual(NO_CALLER_OPTIONS);
  expect(optionsOf({ "ci.yml": "name: ci\non: pull_request\njobs:\n  checks:\n    uses: avi2d/workflows/.github/workflows/ci.yml@v3\n" })).toEqual(NO_CALLER_OPTIONS);
});

test("a hand-rolled Pages deploy gives the build command and the uploaded folder, so --write keeps the site deployed instead of deleting docs.yml", () => {
  expect(optionsOf({ "docs.yml": HAND_ROLLED_DOCS }).pages).toEqual({ build: "bun run docs:build", path: "docs/.vitepress/dist" });
});

test("a Pages deploy with two run steps names no build command, so the generator never guesses which one builds", () => {
  const twoRuns = HAND_ROLLED_DOCS.replace("      - run: bun run docs:build\n", "      - run: bun install\n      - run: bun run docs:build\n");
  expect(optionsOf({ "docs.yml": twoRuns }).pages).toBeUndefined();
});

test("a github-pages.yml caller keeps the build and path it passes, and one missing either input is no deploy", () => {
  const caller = (inputs: string) => `name: docs\non: push\njobs:\n  pages:\n    uses: avi2d/workflows/.github/workflows/github-pages.yml@v3\n    with:\n${inputs}`;
  expect(optionsOf({ "docs.yml": caller("      build: bun run site\n      path: dist\n") }).pages).toEqual({ build: "bun run site", path: "dist" });
  expect(optionsOf({ "docs.yml": caller("      build: bun run site\n") }).pages).toBeUndefined();
});

test("a weekly advisories cron is kept, and a daily or doubled one is dropped rather than copied into the caller", () => {
  const advisories = (crons: readonly string[]) => `name: advisories\non:\n  schedule:\n${crons.map((cron) => `    - cron: "${cron}"\n`).join("")}  workflow_dispatch:\n`;
  expect(optionsOf({ "advisories.yml": advisories(["21 5 * * 1"]) }).advisoriesCron).toBe("21 5 * * 1");
  expect(optionsOf({ "advisories.yml": advisories(["0 5 * * *"]) }).advisoriesCron).toBeUndefined();
  expect(optionsOf({ "advisories.yml": advisories(["21 5 * * 1", "21 5 * * 4"]) }).advisoriesCron).toBeUndefined();
});

test("a hand-rolled flake run keeps the Node version file it sets up, and a caller drops a runs count it passes", () => {
  expect(optionsOf({ "flake.yml": HAND_ROLLED_FLAKE }).flake).toEqual({ nodeVersionFile: ".node-version" });
  const caller = "name: flake\non: workflow_dispatch\njobs:\n  flake:\n    uses: avi2d/workflows/.github/workflows/flake.yml@v3\n    with:\n      runs: 20\n";
  expect(optionsOf({ "flake.yml": caller }).flake).toEqual({ nodeVersionFile: undefined });
});

test("lint reads the secrets pack where ci.yml writes it in a step or passes secrets-pack to static.yml, and not where static.yml gets false", () => {
  expect(optionsOf({ "ci.yml": SINGLE_JOB_CI_WITH_PACK }).secretsPack).toBe(true);
  const composed = (value: string) => `name: ci\non: pull_request\njobs:\n  static:\n    uses: avi2d/workflows/.github/workflows/static.yml@v3\n    with:\n      secrets-pack: ${value}\n`;
  expect(optionsOf({ "ci.yml": composed("true") }).secretsPack).toBe(true);
  expect(optionsOf({ "ci.yml": composed("false") }).secretsPack).toBe(false);
});

test("only a release-main caller that passes publish-workspaces opts the repository into workspace publishing", () => {
  const main = (inputs: string) => `name: main\non: push\njobs:\n  release:\n    uses: avi2d/workflows/.github/workflows/release-main.yml@v3\n${inputs}`;
  const opted = { path: ".github/workflows/main.yml", document: Bun.YAML.parse(main("    with:\n      publish-workspaces: true\n")), text: "" };
  expect(readsPublishWorkspaces([opted])).toBe(true);
  expect(readsPublishWorkspaces([{ ...opted, document: Bun.YAML.parse(main("    with:\n      publish-workspaces: false\n")) }])).toBe(false);
  expect(readsPublishWorkspaces([{ ...opted, document: Bun.YAML.parse(main("")) }])).toBe(false);
  expect(readsPublishWorkspaces([])).toBe(false);
});

test("the full test before a publish follows whether the package publishes, not what main.yml held", () => {
  expect(optionsOf({}, true).fullTest).toBe(true);
  expect(optionsOf({ "main.yml": "name: main\non: push\njobs:\n  release:\n    uses: avi2d/workflows/.github/workflows/release-main.yml@v3\n    with:\n      full-test: true\n" }, false).fullTest).toBe(false);
});
