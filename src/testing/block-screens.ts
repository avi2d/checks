import { BunServices } from "@effect/platform-bun";
import { afterAll, expect, test } from "bun:test";
import { Config, Effect, FileSystem, Path } from "effect";
import { chromium, devices, webkit, type Browser, type LaunchOptions, type Page } from "playwright-core";
import { decodePng, type Picture } from "../quality/browser/png.ts";
import { SCREEN_SIZES, screenSizeName, type ScreenSize, type ScreenSizeSet } from "../quality/browser/screen-sizes.ts";
import { APPROVE_VARIABLE } from "./test-refusal.ts";

export { APPROVE_VARIABLE };

export const SCREEN_ENGINES = ["chromium", "webkit"] as const;

export type ScreenEngine = (typeof SCREEN_ENGINES)[number];

export type Viewport = { readonly width: number; readonly height: number };

export type DeviceOptions = {
  readonly userAgent?: string;
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly hasTouch: boolean;
  readonly viewport: Viewport;
  readonly screen: Viewport;
};

export type ScreenDevice = { readonly name: string; readonly options: DeviceOptions };

type Devices = typeof devices;

export type DeviceDescriptor = keyof { [Name in keyof Devices as string extends Name ? never : Name]: Devices[Name] };

const sized = (label: string, { width, height }: Viewport): string => `${label} ${String(width)}x${String(height)}`;

export function emulatedDevice(label: string, descriptor: DeviceDescriptor, viewport: Viewport, deviceScaleFactor?: number): ScreenDevice {
  const { userAgent, isMobile, hasTouch, ...described } = devices[descriptor];
  return {
    name: sized(label, viewport),
    options: { userAgent, deviceScaleFactor: deviceScaleFactor ?? described.deviceScaleFactor, isMobile, hasTouch, viewport, screen: viewport },
  };
}

export const windowDevice = (viewport: Viewport): ScreenDevice => emulatedDevice("desktop", "Desktop Chrome", viewport);

const IPHONES: Readonly<Partial<Record<string, { readonly label: string; readonly descriptor: DeviceDescriptor }>>> = {
  "phone-375x667": { label: "iPhone SE", descriptor: "iPhone SE (3rd gen)" },
  "phone-393x852": { label: "iPhone 15 and 16", descriptor: "iPhone 16" },
};

function sizeDevice(size: ScreenSize): ScreenDevice {
  const viewport = { width: size.width, height: size.height };
  const iphone = IPHONES[screenSizeName(size)];
  if (iphone !== undefined) return emulatedDevice(iphone.label, iphone.descriptor, viewport);
  switch (size.device) {
    case "phone":
      return emulatedDevice("Android", "Pixel 7", viewport);
    case "tablet":
      return { name: sized("iPad", viewport), options: { viewport, screen: viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
    case "desktop":
      return windowDevice(viewport);
  }
}

export const screenDevices = (set: ScreenSizeSet): readonly ScreenDevice[] => SCREEN_SIZES[set].map(sizeDevice);

export const HANDHELDS: readonly ScreenDevice[] = [
  emulatedDevice("iPhone 13 and 14", "iPhone 14", { width: 390, height: 844 }),
  emulatedDevice("iPhone 16 Plus", "iPhone 16 Plus", { width: 430, height: 932 }),
  emulatedDevice("iPhone 16 Pro Max", "iPhone 16 Pro Max", { width: 440, height: 956 }),
  emulatedDevice("Android", "Pixel 7", { width: 360, height: 800 }, 3),
  emulatedDevice("Android", "Pixel 7", { width: 384, height: 854 }, 2.8125),
  emulatedDevice("iPad gen 6", "iPad (gen 6)", { width: 768, height: 1024 }),
];

export const pictureFile = (engine: ScreenEngine, device: ScreenDevice): string =>
  `${engine}/${device.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.png`;

export type Tolerance = {
  readonly channel: number;
  readonly share: number;
};

export const EXACT: Tolerance = { channel: 0, share: 0 };

const differingPixels = (now: Picture, then: Picture, channel: number): number => {
  let differing = 0;
  for (let at = 0; at < now.rgb.length; at += 3) {
    const moved = [0, 1, 2].some((offset) => Math.abs((now.rgb[at + offset] ?? 0) - (then.rgb[at + offset] ?? 0)) > channel);
    if (moved) differing += 1;
  }
  return differing;
};

const mismatch = (now: Picture, then: Picture, { channel, share }: Tolerance): string | undefined => {
  if (now.width !== then.width || now.height !== then.height)
    return `is ${String(now.width)}x${String(now.height)} and the approved picture is ${String(then.width)}x${String(then.height)}`;
  const differing = differingPixels(now, then, channel);
  return differing <= Math.floor(now.width * now.height * share) ? undefined : `has ${String(differing)} pixel(s) that differ from the approved picture`;
};

export type ApprovalMode = "compare" | "approve";

const modeFromEnvironment = Config.Boolean(APPROVE_VARIABLE).pipe(
  Config.withDefault(false),
  Config.map((approving): ApprovalMode => (approving ? "approve" : "compare")),
);

export type PictureAt = {
  readonly fixtures: string;
  readonly engine: ScreenEngine;
  readonly device: ScreenDevice;
  readonly tolerance?: Tolerance;
};

export const AS_APPROVED = "the picture is as approved";

const judged = Effect.fn("judged")(function* (picture: Uint8Array, at: PictureAt, given: ApprovalMode | undefined) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const approved = path.join(at.fixtures, pictureFile(at.engine, at.device));
  const fresh = approved.replace(/\.png$/, ".new.png");
  const shown = (file: string): string => path.relative(process.cwd(), file);
  const forget = fs.remove(fresh, { force: true });
  const keep = (why: string) =>
    fs.writeFile(fresh, picture).pipe(Effect.as(`${at.device.name} in ${at.engine}: ${why}, so the new picture is at ${shown(fresh)}`));
  yield* fs.makeDirectory(path.dirname(approved), { recursive: true });
  if ((given ?? (yield* modeFromEnvironment)) === "approve") return yield* fs.writeFile(approved, picture).pipe(Effect.andThen(forget), Effect.as(AS_APPROVED));
  if (!(yield* fs.exists(approved))) return yield* keep(`no approved picture is at ${shown(approved)}`);
  const [now, then] = yield* Effect.all([decodePng(picture), Effect.flatMap(fs.readFile(approved), decodePng)]);
  const found = mismatch(now, then, at.tolerance ?? EXACT);
  return yield* found === undefined ? forget.pipe(Effect.as(AS_APPROVED)) : keep(`the picture ${found} at ${shown(approved)}`);
});

export const matchesApproved = (picture: Uint8Array, at: PictureAt, mode?: ApprovalMode): Promise<string> =>
  Effect.runPromise(judged(picture, at, mode).pipe(Effect.provide(BunServices.layer)));

const PICTURE_OPTIONS = { scale: "css", animations: "disabled", caret: "hide" } as const;

export const pictureOf = (page: Page, selector?: string): Promise<Uint8Array> =>
  selector === undefined ? page.screenshot(PICTURE_OPTIONS) : page.locator(selector).screenshot(PICTURE_OPTIONS);

const SETTLED = `document.fonts.ready.then(() => Promise.all(document.getAnimations().filter((animation) => animation.playState !== "paused" && animation.timeline === document.timeline && animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished))).then(() => undefined)`;

export const settled = (page: Page): Promise<unknown> => page.evaluate(SETTLED);

export const launchBrowser = (engine: ScreenEngine, options: LaunchOptions = {}): Promise<Browser> =>
  engine === "webkit"
    ? webkit.launch(options)
    : // Headless shell snaps glyph advances to whole pixels, so a picture would not match one from a full Chromium.
      chromium.launch({ ...options, args: ["--font-render-hinting=none", ...(options.args ?? [])] });

export type BlockSuite = {
  readonly block: string;
  readonly fixtures: string;
  readonly url: string | (() => Promise<string>);
  readonly selector?: string;
  readonly setup?: (page: Page) => Promise<unknown>;
  readonly sizes?: ScreenSizeSet;
  readonly devices?: readonly ScreenDevice[];
  readonly tolerance?: Tolerance;
  readonly timeoutMs?: number;
};

const blockPicture = (browser: Browser, suite: BlockSuite, device: ScreenDevice): Promise<Uint8Array> =>
  browser.newContext(device.options).then((context) =>
    context
      .newPage()
      .then((page) =>
        (typeof suite.url === "string" ? Promise.resolve(suite.url) : suite.url())
          .then((url) => page.goto(url, { waitUntil: "networkidle" }))
          .then(() => settled(page))
          .then(() => suite.setup?.(page))
          .then(() => pictureOf(page, suite.selector)),
      )
      .finally(() => context.close()),
  );

export function blockScreens(engine: ScreenEngine, suite: BlockSuite): void {
  let launched: Promise<Browser> | undefined;
  afterAll(() => launched?.then((browser) => browser.close()));
  const listed = [...screenDevices(suite.sizes ?? "anchor"), ...(suite.devices ?? [])];
  for (const device of listed) {
    test(
      `${suite.block} at ${device.name} in ${engine} looks as approved, instead of changing its look with no picture approving it`,
      () => {
        launched ??= launchBrowser(engine);
        return launched
          .then((browser) => blockPicture(browser, suite, device))
          .then((picture) => matchesApproved(picture, { fixtures: suite.fixtures, engine, device, ...(suite.tolerance === undefined ? {} : { tolerance: suite.tolerance }) }))
          .then((verdict) => expect(verdict).toBe(AS_APPROVED));
      },
      suite.timeoutMs ?? 60_000,
    );
  }
}
