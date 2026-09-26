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

test("duplicate vendor source names fail before a fetch", async () => {
  const library = { name: "effect", package: "effect", repository: "https://example.com/effect.git", tag: "v{version}" };
  const repo = await open({ "package.json": JSON.stringify({ vendorSources: [library, library] }) });
  const red = await repo.script("vendor.ts");
  expect(red.exitCode).toBe(2);
  expect(red.text).toContain("vendorSources names effect more than once");
  await repo.write({ "package.json": JSON.stringify({ vendorSources: [] }) });
  const green = await repo.script("vendor.ts");
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
