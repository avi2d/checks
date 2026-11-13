import { $ } from "bun";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { decodePng } from "../../src/quality/browser/png.ts";
import { ran, scratchDirs } from "../e2e/lib/fixture-repo.ts";
import { browserConsumer } from "../e2e/lib/packed.ts";

const scratch = scratchDirs();

const ANCHOR_PICTURES = ["android-360x640", "iphone-se-375x667", "iphone-15-and-16-393x852", "android-412x915", "ipad-820x1180", "desktop-1366x768", "desktop-1440x900", "desktop-1920x1080"];

const suite = (color: string): string => `import { join } from "node:path";
import { blockScreens, SCREEN_ENGINES } from "@avi2dg/checks/block-screens.ts";

const page = "<style>body { margin: 0 } .card { width: 120px; height: 80px; background: ${color} }</style><div class=card></div>";

for (const engine of SCREEN_ENGINES) {
  blockScreens(engine, { block: "card", fixtures: join(import.meta.dir, "..", "fixtures", "card-screens"), url: "data:text/html," + encodeURIComponent(page), selector: ".card" });
}
`;

const pictures = async (dir: string): Promise<readonly string[]> =>
  (await Promise.all(["chromium", "webkit"].map(async (engine) => (existsSync(join(dir, engine)) ? (await readdir(join(dir, engine))).map((file) => `${engine}/${file}`) : [])))).flat().toSorted();

const named = (suffix: string): readonly string[] => ["chromium", "webkit"].flatMap((engine) => ANCHOR_PICTURES.map((name) => `${engine}/${name}${suffix}`)).toSorted();

test(
  "a consumer's block suite fails and keeps new pictures with none approved, approves them on request, passes on them, and fails a changed look at each size, instead of passing pictures nobody approved",
  async () => {
    const dir = await browserConsumer(scratch, "block");
    await mkdir(join(dir, "tests", "pixel"), { recursive: true });
    const fixtures = join(dir, "tests", "fixtures", "card-screens");
    const run = async (color: string, approve = false) => {
      await writeFile(join(dir, "tests", "pixel", "card-screens.test.ts"), suite(color));
      return ran($`bun test tests/pixel`.cwd(dir).env({ ...process.env, APPROVE_SCREENS: approve ? "1" : "0" }));
    };

    const unapproved = await run("rgb(200, 40, 90)");
    expect([unapproved.exitCode, unapproved.text]).toEqual([1, expect.stringContaining("16 fail")]);
    expect(await pictures(fixtures)).toEqual(named(".new.png"));

    const approved = await run("rgb(200, 40, 90)", true);
    expect([approved.exitCode, await pictures(fixtures)]).toEqual([0, named(".png")]);
    for (const file of named(".png")) {
      const picture = await Effect.runPromise(decodePng(await readFile(join(fixtures, file))));
      const pixels = Array.from({ length: picture.width * picture.height }, (_pixel, at) => [...picture.rgb.subarray(at * 3, at * 3 + 3)].join(","));
      expect([file, picture.width, picture.height, [...new Set(pixels)]]).toEqual([file, 120, 80, ["200,40,90"]]);
    }

    expect((await run("rgb(200, 40, 90)")).exitCode).toBe(0);

    const changed = await run("rgb(200, 40, 91)");
    expect(changed.exitCode).toBe(1);
    expect(changed.text).toContain("16 fail");
    expect(changed.text).toContain("iPhone SE 375x667 in webkit: the picture has 9600 pixel(s) that differ from the approved picture");
    expect(await pictures(fixtures)).toEqual([...named(".new.png"), ...named(".png")].toSorted());
  },
  300_000,
);
