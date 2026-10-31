import { $ } from "bun";
import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, scratchDirs } from "./lib/fixture-repo.ts";

const scratch = scratchDirs();

const ANCHOR_SIZES = ["phone-360x640", "phone-375x667", "phone-393x852", "phone-412x915", "tablet-820x1180", "desktop-1366x768", "desktop-1440x900", "desktop-1920x1080"];
const NIGHTLY_SIZES = ["phone-320x568", "phone-360x540", "phone-375x567", "phone-375x812", "phone-390x844", "phone-430x932", "tablet-768x1024", "tablet-1024x1366", "desktop-1280x800", "desktop-1536x864", "desktop-2560x1440"];

const SIZES_PROGRAM = `import { ENLARGED_TEXT_PX, SCREEN_SIZES, screenSizeName } from "@avi2dg/checks/screen-sizes.ts";
console.log(JSON.stringify({ anchor: SCREEN_SIZES.anchor.map(screenSizeName), full: SCREEN_SIZES.full.map(screenSizeName), enlarged: ENLARGED_TEXT_PX }));
`;

test(
  "packed-tarball consumer imports the screen sizes rather than meeting an export missing from the install",
  async () => {
    const packDir = await scratch("checks-sizes-pack-");
    const packed = await $`bun pm pack --destination ${packDir} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet();
    const dir = await scratch("checks-sizes-consumer-");
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "sizes-consumer", type: "module", dependencies: { "@avi2dg/checks": `file:${packed.stdout.toString().trim()}` } }));
    await $`bun install --ignore-scripts`.cwd(dir).quiet();
    await writeFile(join(dir, "sizes.ts"), SIZES_PROGRAM);

    const run = await $`bun sizes.ts`.cwd(dir).quiet();
    expect(JSON.parse(run.stdout.toString())).toEqual({ anchor: ANCHOR_SIZES, full: [...ANCHOR_SIZES, ...NIGHTLY_SIZES], enlarged: 32 });
  },
  180_000,
);
