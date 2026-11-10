import { $ } from "bun";
import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();

const suite = (devices: string): string => `import { blockScreens, HANDHELDS } from "${join(CHECKOUT, "src", "testing", "block-screens.ts")}";

blockScreens("chromium", { block: "card", fixtures: "fixtures", url: "data:text/html,", sizes: "full", devices: ${devices} });
`;

const deviceCheck = async (devices: string) => {
  const dir = await scratch("block-screens-devices-");
  await writeFile(join(dir, "card.test.ts"), suite(devices));
  return ran($`bun test ./card.test.ts -t ${"names each device once"}`.cwd(dir));
};

test("a suite that lists one device name twice fails and names it, instead of two devices writing one approved picture", async () => {
  const twice = await deviceCheck("HANDHELDS");
  expect(twice.exitCode).toBe(1);
  expect(twice.text).toContain("card in chromium names each device once");
  expect(twice.text).toContain('+   "iPad 768x1024",');
  expect(twice.text).toContain("24 filtered out");
});

test("a suite whose devices each name a picture of their own registers no device check, instead of failing a suite with nothing doubled", async () => {
  const once = await deviceCheck("HANDHELDS.slice(0, 5)");
  expect([once.exitCode, once.text]).toEqual([1, expect.stringContaining('regex "names each device once" matched 0 tests. Searched 1 file (skipping 24 tests)')]);
});
