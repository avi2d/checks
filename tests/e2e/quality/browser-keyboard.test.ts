import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf } from "../lib/browser-site.ts";

const checkFixture = async (file: string, labels: readonly string[], withoutFocus: readonly string[]) => {
  const html = await Bun.file(new URL("../../fixtures/keyboard/" + file, import.meta.url)).text();
  const site = await browserSite({
    "dist/index.html": html,
    "checks.config.ts": declaration({
      targets: labels.map((name) => ({ name, selector: "#" + name, focusable: true })),
      checks: ["keyboard"],
    }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual(withoutFocus.map((name) => `${at("keyboard", "/")} ${name} shows no visible focus when Tab reaches it`));
  for (const name of labels) expect(ran.text).toContain(`${name} 1`);
  expect(ran.exitCode).toBe(withoutFocus.length === 0 ? 0 : 1);
};

test("keyboard does not count a distant message inside a transparently outlined form", () => checkFixture("distant-message.html", ["link", "field"], ["field"]));
