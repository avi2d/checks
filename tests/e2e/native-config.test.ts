import { expect, test } from "bun:test";
import { fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-native-config-");
const rules = {
  "max-lines": ["error", { max: 400, skipBlankLines: false, skipComments: false }],
  "max-statements": ["error", { max: 30 }],
};

test("an empty size scope fails before a production override makes it measurable", async () => {
  const repo = await open({
    "src/index.ts": "export const answer = 42;\n",
    ".oxlintrc.json": JSON.stringify({ plugins: ["eslint"], rules }),
  });
  const base = await repo.commit("start");
  const red = await repo.script("size-budget.ts", "HEAD");
  expect(red.exitCode).toBe(2);
  expect(red.text).toContain("size rules have no production override with files");
  await repo.write({
    ".oxlintrc.json": JSON.stringify({ plugins: ["eslint"], overrides: [{ files: ["src/**/*.ts"], rules }] }),
    "src/index.ts": "export const answer = 43;\n",
  });
  const head = await repo.commit("restore scope");
  const green = await repo.script("size-budget.ts", base, head);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("1 file(s)");
});

test("a size override that scans no tracked production file fails", async () => {
  const config = (glob: string) => JSON.stringify({ plugins: ["eslint"], overrides: [{ files: [glob], rules }] });
  const repo = await open({ "src/index.ts": "export const answer = 42;\n", ".oxlintrc.json": config("lost/**/*.ts") });
  await repo.commit("start");
  const red = await repo.script("size-budget.ts", "HEAD");
  expect(red.exitCode).toBe(2);
  expect(red.text).toContain("production override lost/**/*.ts matches no tracked file");
  await repo.write({ ".oxlintrc.json": config("src/**/*.ts") });
  const green = await repo.script("size-budget.ts", "HEAD");
  expect(green.exitCode).toBe(0);
});

test("a size override cannot mix test and production paths", async () => {
  const config = (files: readonly string[]) => JSON.stringify({ plugins: ["eslint"], overrides: [{ files, rules }] });
  const repo = await open({
    "src/index.ts": "export const answer = 42;\n",
    "tests/index.test.ts": "import { test } from \"bun:test\";\ntest(\"answer\", () => {});\n",
    ".oxlintrc.json": config(["src/**/*.ts", "tests/**/*.ts"]),
  });
  await repo.commit("start");
  const red = await repo.script("size-budget.ts", "HEAD");
  expect(red.exitCode).toBe(2);
  expect(red.text).toContain("size override mixes tests and production paths");
  await repo.write({ ".oxlintrc.json": config(["src/**/*.ts"]) });
  const green = await repo.script("size-budget.ts", "HEAD");
  expect(green.exitCode).toBe(0);
});

test("turning a native size rule off removes its limit", async () => {
  const config = (maxLines: unknown) => JSON.stringify({ plugins: ["eslint"], overrides: [{ files: ["src/**/*.ts"], rules: { "max-lines": maxLines } }] });
  const repo = await open({
    "src/index.ts": "export const first = 1;\n",
    ".oxlintrc.json": config(["error", { max: 2 }]),
  });
  const base = await repo.commit("start");
  await repo.write({ "src/index.ts": "export const first = 1;\nexport const second = 2;\nexport const third = 3;\n" });
  const head = await repo.commit("grow file");
  const red = await repo.script("size-budget.ts", base, head);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("max-lines over by 1");
  await repo.write({ ".oxlintrc.json": config("off") });
  const green = await repo.script("size-budget.ts", base, head);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("raise no overrun");
});

test("an oxlint config that names no size rule declares no budget", async () => {
  const config = (extra: Readonly<Record<string, unknown>>) => JSON.stringify({ plugins: ["eslint"], rules: { "no-console": "error", ...extra } });
  const repo = await open({ "src/index.ts": "export const answer = 42;\n", ".oxlintrc.json": config({}) });
  await repo.commit("start");
  const none = await repo.script("size-budget.ts", "HEAD");
  expect(none.exitCode).toBe(0);
  expect(none.text).toContain(".oxlintrc.json declares no size rules");
  await repo.write({ ".oxlintrc.json": config({ "max-lines": ["error", { max: 400 }] }) });
  const unscoped = await repo.script("size-budget.ts", "HEAD");
  expect(unscoped.exitCode).toBe(2);
  expect(unscoped.text).toContain("size rules have no production override with files");
});

test("each production override holds its own files to its own limits, as oxlint does", async () => {
  const maxLines = (max: number) => ({ "max-lines": ["error", { max, skipBlankLines: false, skipComments: false }] });
  const config = (scriptsMax: number) =>
    JSON.stringify({
      plugins: ["eslint"],
      overrides: [
        { files: ["src/**/*.ts"], rules: maxLines(3) },
        { files: ["scripts/**/*.ts"], rules: maxLines(scriptsMax) },
      ],
    });
  const repo = await open({
    "src/index.ts": "export const first = 1;\n",
    "scripts/tool.ts": "export const tool = 1;\n",
    ".oxlintrc.json": config(1),
  });
  const base = await repo.commit("start");
  await repo.write({
    "src/index.ts": "export const first = 1;\nexport const second = 2;\nexport const third = 3;\n",
    "scripts/tool.ts": "export const tool = 1;\nexport const more = 2;\n",
  });
  const head = await repo.commit("grow both");
  const red = await repo.script("size-budget.ts", base, head);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("scripts/tool.ts: max-lines over by 1");
  expect(red.text).not.toContain("src/index.ts: max-lines");
  await repo.write({ ".oxlintrc.json": config(2) });
  const green = await repo.script("size-budget.ts", base, head);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("2 file(s)");
});

test("an override naming test files at any depth holds the tests, not production", async () => {
  const testsOnly = { files: ["*.test.ts"], rules: { "max-lines": ["error", { max: 2 }] } };
  const production = { files: ["src/**/*.ts"], rules: { "max-lines": ["error", { max: 400 }] } };
  const repo = await open({
    "src/index.ts": "export const first = 1;\n",
    "src/index.test.ts": "export const checked = 1;\n",
    ".oxlintrc.json": JSON.stringify({ plugins: ["eslint"], overrides: [testsOnly] }),
  });
  const base = await repo.commit("start");
  const unscoped = await repo.script("size-budget.ts", "HEAD");
  expect(unscoped.exitCode).toBe(2);
  expect(unscoped.text).toContain("size rules have no production override with files");
  await repo.write({
    ".oxlintrc.json": JSON.stringify({ plugins: ["eslint"], overrides: [production, testsOnly] }),
    "src/index.ts": "export const first = 1;\nexport const second = 2;\nexport const third = 3;\n",
    "src/index.test.ts": "export const checked = 1;\nexport const more = 2;\nexport const most = 3;\n",
  });
  const head = await repo.commit("grow both");
  const red = await repo.script("size-budget.ts", base, head);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("src/index.test.ts: max-lines over by 1");
  expect(red.text).not.toContain("src/index.ts: max-lines");
});
