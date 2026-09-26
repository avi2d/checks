import { expect, test } from "bun:test";
import { fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-ci-wiring-");
const workflow = `on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n      - run: bun run build\n      - run: git diff --exit-code\n      - run: bun run typecheck\n      - run: bun run test\n      - run: ./node_modules/.bin/commitlint\n`;

test("the installed bin refuses an omitted gate and accepts its restored step", async () => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "checks-lint", test: "checks-test" } }),
    "src/index.ts": "export const answer = 42;\n",
    ".github/workflows/ci.yml": workflow.replace("      - run: bun run test\n", ""),
  });
  await repo.commit("start");
  const red = await repo.script("ci-wiring.ts");
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("bun run test");
  await repo.write({ ".github/workflows/ci.yml": workflow });
  const green = await repo.script("ci-wiring.ts");
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("6 gate(s) run");
});

test("false if and continue-on-error cannot make a required step green", async () => {
  const repo = await open({ "package.json": JSON.stringify({ scripts: { lint: "checks-lint", test: "checks-test" } }), "src/index.ts": "export const answer = 42;\n", ".github/workflows/ci.yml": workflow });
  await repo.commit("start");
  for (const disabled of ["if: false", "continue-on-error: true"]) {
    await repo.write({ ".github/workflows/ci.yml": workflow.replace("      - run: bun run lint", `      - run: bun run lint\n        ${disabled}`) });
    const red = await repo.script("ci-wiring.ts");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(disabled);
  }
  await repo.write({ ".github/workflows/ci.yml": workflow });
  expect((await repo.script("ci-wiring.ts")).exitCode).toBe(0);
});
