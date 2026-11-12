import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { decodePng } from "../../../src/quality/browser/png.ts";
import { AS_APPROVED, HANDHELDS, matchesApproved, pictureFile, screenDevices, type ScreenDevice } from "../../../src/testing/block-screens.ts";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "block-screens");
const picture = (name: string): Promise<Uint8Array> => readFile(join(FIXTURES, `${name}.png`));

const made: string[] = [];
afterAll(() => Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true }))));

const fixturesDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "block-screens-"));
  made.push(dir);
  return dir;
};

const deviceNamed = (name: string): ScreenDevice => {
  const found = screenDevices("anchor").find((device) => device.name === name);
  if (found === undefined) throw new Error(`no anchor device ${name}`);
  return found;
};

const approvedAt = async (fixtures: string, device: ScreenDevice, png: Uint8Array): Promise<string> => {
  const file = join(fixtures, pictureFile("chromium", device));
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, png);
  return file;
};

const KIT_SIZES = [
  ...["phone-360x640", "phone-375x667", "phone-393x852", "phone-412x915", "tablet-820x1180", "desktop-1366x768", "desktop-1440x900", "desktop-1920x1080"],
  ...["phone-320x568", "phone-360x540", "phone-375x567", "phone-375x812", "phone-390x844", "phone-430x932", "tablet-768x1024", "tablet-1024x1366"],
  ...["desktop-1280x800", "desktop-1536x864", "desktop-2560x1440"],
];

describe("the screen devices", () => {
  test("open each of the kit's 19 screen sizes once, phones and tablets with touch on a mobile viewport, instead of dropping, doubling or desktop-emulating a published size", () => {
    const opened = screenDevices("full").map(({ options: { viewport, isMobile, hasTouch } }) => [
      `${String(viewport.width)}x${String(viewport.height)}`,
      isMobile === hasTouch ? isMobile : "touch without a mobile viewport",
    ]);
    expect(opened).toEqual(KIT_SIZES.map((size) => [size.replace(/^[a-z]+-/, ""), !size.startsWith("desktop")]));
  });

  test("name each anchor size's picture as azalialaw's approved hero pictures are named, instead of renaming every approved picture a repository holds", () => {
    expect(screenDevices("anchor").map((device) => pictureFile("webkit", device))).toEqual(
      ["android-360x640", "iphone-se-375x667", "iphone-15-and-16-393x852", "android-412x915", "ipad-820x1180", "desktop-1366x768", "desktop-1440x900", "desktop-1920x1080"].map((name) => `webkit/${name}.png`),
    );
  });
});

describe("the handhelds", () => {
  test("open each phone and tablet at its CSS size and pixel ratio with touch on a mobile viewport, instead of a desktop window at a phone's size", () => {
    const opened = HANDHELDS.map(({ options: { viewport, screen, deviceScaleFactor, isMobile, hasTouch } }) => [viewport, screen, deviceScaleFactor, isMobile, hasTouch]);
    const handheld = (width: number, height: number, ratio: number) => [{ width, height }, { width, height }, ratio, true, true];
    expect(opened).toEqual([handheld(390, 844, 3), handheld(430, 932, 3), handheld(440, 956, 3), handheld(360, 800, 3), handheld(384, 854, 2.8125), handheld(768, 1024, 2)]);
  });

  test("name each picture for the phone it shows, instead of naming two handhelds of one size the same picture", () => {
    expect(HANDHELDS.map((device) => pictureFile("chromium", device))).toEqual(
      ["iphone-13-and-14-390x844", "iphone-16-plus-430x932", "iphone-16-pro-max-440x956", "android-360x800", "android-384x854", "ipad-gen-6-768x1024"].map((name) => `chromium/${name}.png`),
    );
  });

  test("picture each full size and handheld in its own file, instead of a handheld sharing a picture file with a full size", () => {
    expect(new Set([...screenDevices("full"), ...HANDHELDS].map((device) => pictureFile("chromium", device))).size).toBe(25);
  });

  test("send the user agent of the phone each names, instead of a desktop browser's", () => {
    expect(HANDHELDS.map(({ options: { userAgent } }) => /iPhone|iPad|Android/.exec(userAgent ?? "")?.[0])).toEqual(["iPhone", "iPhone", "iPhone", "Android", "Android", "iPad"]);
  });
});

describe("a PNG", () => {
  test("from Chromium as RGB and from WebKit as RGBA decodes to the colors its page painted, instead of misreading a filter or the alpha channel", async () => {
    const painted = Array.from({ length: 6 }, (_row, y) => Array.from({ length: 8 }, (_column, x) => [x * 32 + 7, y * 40 + 11, (x * 13 + y * 29) % 256])).flat(2);
    for (const engine of ["chromium", "webkit"]) {
      const decoded = await Effect.runPromise(decodePng(await picture(engine)));
      expect([decoded.width, decoded.height, [...decoded.rgb]]).toEqual([8, 6, painted]);
    }
  });

  test("that is not a PNG fails with its reason, instead of passing as an empty picture", async () => {
    const failed = await Effect.runPromise(Effect.flip(decodePng(new TextEncoder().encode("not a picture"))));
    expect(failed.message).toBe("it is not a PNG");
  });
});

describe("a picture of a block", () => {
  const device = deviceNamed("iPhone SE 375x667");

  test("that matches its approved picture passes and keeps no new picture, instead of failing on identical pixels another engine encoded", async () => {
    const fixtures = await fixturesDir();
    const approved = await approvedAt(fixtures, device, await picture("webkit"));
    expect(await matchesApproved(await picture("chromium"), { fixtures, engine: "chromium", device }, "compare")).toBe(AS_APPROVED);
    expect(existsSync(approved.replace(/\.png$/, ".new.png"))).toBe(false);
  });

  test("that differs by one pixel fails, names the size, and keeps the new picture beside the approved one, instead of passing a changed look", async () => {
    const fixtures = await fixturesDir();
    const approved = await approvedAt(fixtures, device, await picture("chromium"));
    const changed = await picture("chromium-one-pixel");
    const verdict = await matchesApproved(changed, { fixtures, engine: "chromium", device }, "compare");
    expect(verdict).toStartWith("iPhone SE 375x667 in chromium: the picture has 1 pixel(s) that differ from the approved picture at ");
    expect(verdict).toEndWith("chromium/iphone-se-375x667.new.png");
    expect(await readFile(approved.replace(/\.png$/, ".new.png"))).toEqual(Buffer.from(changed));
    expect(await readFile(approved)).toEqual(Buffer.from(await picture("chromium")));
  });

  test("that differs by one pixel of 48 passes under a tolerance of one pixel in 40, instead of ignoring the tolerance a repository sets", async () => {
    const fixtures = await fixturesDir();
    await approvedAt(fixtures, device, await picture("chromium"));
    const tolerance = { channel: 0, share: 1 / 40 };
    expect(await matchesApproved(await picture("chromium-one-pixel"), { fixtures, engine: "chromium", device, tolerance }, "compare")).toBe(AS_APPROVED);
  });

  test("with no approved picture fails, names the size, and writes the new picture beside where the approved one goes, instead of passing a block nobody approved", async () => {
    const fixtures = await fixturesDir();
    const desktop = deviceNamed("desktop 1366x768");
    const shot = await picture("webkit");
    const verdict = await matchesApproved(shot, { fixtures, engine: "webkit", device: desktop }, "compare");
    expect(verdict).toStartWith("desktop 1366x768 in webkit: no approved picture is at ");
    expect(await readFile(join(fixtures, "webkit", "desktop-1366x768.new.png"))).toEqual(Buffer.from(shot));
    expect(existsSync(join(fixtures, "webkit", "desktop-1366x768.png"))).toBe(false);
  });

  test("in approve mode replaces the approved picture and drops the new one, instead of leaving the old look approved", async () => {
    const fixtures = await fixturesDir();
    const approved = await approvedAt(fixtures, device, await picture("chromium"));
    const changed = await picture("chromium-one-pixel");
    expect(await matchesApproved(changed, { fixtures, engine: "chromium", device }, "compare")).not.toBe(AS_APPROVED);
    expect(await matchesApproved(changed, { fixtures, engine: "chromium", device }, "approve")).toBe(AS_APPROVED);
    expect(await readFile(approved)).toEqual(Buffer.from(changed));
    expect(existsSync(approved.replace(/\.png$/, ".new.png"))).toBe(false);
    expect(await matchesApproved(changed, { fixtures, engine: "chromium", device }, "compare")).toBe(AS_APPROVED);
  });
});
