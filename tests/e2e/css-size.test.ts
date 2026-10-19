import { expect, test } from "bun:test";
import { fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-css-size-");

const GATE = "quality/css-size.ts";

const line = "a { top: 0; }\n";

test(
  "red on a stylesheet over 400 lines anywhere in the tree, build output included, and green once it is split",
  async () => {
    const { dir, write, script } = await open({
      "package.json": JSON.stringify({ name: "css-size-fixture", type: "module" }),
      "src/site.css": line.repeat(3),
      "src/full.css": line.repeat(400),
      "src/site.css.map": line.repeat(1901),
      "dist/bundle.css": line.repeat(3),
    });

    const green = await script(GATE);
    expect(green.exitCode).toBe(0);
    expect(green.text).toBe("css-size: no stylesheet over 400 lines among 3 CSS file(s)\n");

    await write({ "src/site.css": line.repeat(401) });
    const red = await script(GATE);
    expect(red.exitCode).toBe(1);
    expect(red.text).toBe(
      "css-size: 1 violation(s)\n  src/site.css: 401 lines, over the 400-line budget; split the stylesheet into smaller files\n",
    );

    const explicit = await script(GATE, dir);
    expect(explicit.exitCode).toBe(1);
    expect(explicit.text).toContain("css-size: 1 violation(s)");

    await write({ "dist/bundle.css": line.repeat(1901) });
    const both = await script(GATE);
    expect(both.exitCode).toBe(1);
    expect(both.text).toBe(
      "css-size: 2 violation(s)\n  dist/bundle.css: 1901 lines, over the 400-line budget; split the stylesheet into smaller files\n  src/site.css: 401 lines, over the 400-line budget; split the stylesheet into smaller files\n",
    );

    await write({ "src/site.css": line.repeat(3), "dist/bundle.css": line.repeat(3) });
    expect(await script(GATE)).toEqual(green);
  },
  120_000,
);
