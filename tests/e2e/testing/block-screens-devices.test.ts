import { $ } from "bun";
import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();

test("sizes full with the handheld list registers a picture test for each device, instead of failing on a doubled name", async () => {
  const dir = await scratch("block-screens-devices-");
  const suite = `import { blockScreens, HANDHELDS } from "${join(CHECKOUT, "src", "testing", "block-screens.ts")}";`;
  const body = "\n\nblockScreens('chromium', { block: 'card', fixtures: 'fixtures', url: 'data:text/html,', sizes: 'full', devices: HANDHELDS });\n";
  await writeFile(join(dir, "card.test.ts"), suite + body);
  const found = await ran($`bun test ./card.test.ts -t ${"names each device once"}`.cwd(dir));
  const wanted = 'regex "names each device once" matched 0 tests. Searched 1 file (skipping 25 tests)';
  expect([found.exitCode, found.text]).toEqual([1, expect.stringContaining(wanted)]);
});
