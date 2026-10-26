import { $ } from "bun";
import { expect, test } from "bun:test";
import { fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-no-plain-js-");

test(
  "red on a plain script and green once it is converted, while generated output, served assets and Stryker entries pass",
  async () => {
    const { dir, commit, script } = await open({
      "package.json": JSON.stringify({ name: "no-plain-js-fixture", type: "module" }),
      "src/index.ts": "export const index = 1;\n",
      "src/legacy.js": "export const legacy = 1;\n",
      "tools/build.mjs": "export const build = 1;\n",
      "dist/bundle.js": "export const bundle = 1;\n",
      "public/app.js": "export const app = 1;\n",
      "stryker.conf.mjs": "export default {};\n",
    });
    await commit("feat: base");

    const red = await script("quality/no-plain-js.ts");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(
      "no-plain-js: 2 violation(s)\n  src/legacy.js: plain JavaScript source in a TypeScript repository; convert it to TypeScript\n  tools/build.mjs: plain JavaScript source in a TypeScript repository; convert it to TypeScript\n",
    );

    const explicit = await script("quality/no-plain-js.ts", dir);
    expect(explicit.exitCode).toBe(1);
    expect(explicit.text).toContain("no-plain-js: 2 violation(s)");

    await $`rm src/legacy.js tools/build.mjs && git add -A`.cwd(dir).quiet();
    const green = await script("quality/no-plain-js.ts");
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("no-plain-js: no plain JavaScript sources among 5 tracked file(s)\n");
  },
  120_000,
);
