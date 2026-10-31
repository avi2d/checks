import type { NonEmptyReadonlyArray } from "effect/Array";

export const DEVICES = ["phone", "tablet", "desktop"] as const;

type Device = (typeof DEVICES)[number];

export type ScreenSize = { readonly device: Device; readonly width: number; readonly height: number };

const phone = (width: number, height: number): ScreenSize => ({ device: "phone", width, height });
const tablet = (width: number, height: number): ScreenSize => ({ device: "tablet", width, height });
const desktop = (width: number, height: number): ScreenSize => ({ device: "desktop", width, height });

const ANCHOR = [
  phone(360, 640),
  phone(375, 667),
  phone(393, 852),
  phone(412, 915),
  tablet(820, 1180),
  desktop(1366, 768),
  desktop(1440, 900),
  desktop(1920, 1080),
] as const;

const NIGHTLY = [
  phone(320, 568),
  phone(360, 540),
  phone(375, 567),
  phone(375, 812),
  phone(390, 844),
  phone(430, 932),
  tablet(768, 1024),
  tablet(1024, 1366),
  desktop(1280, 800),
  desktop(1536, 864),
  desktop(2560, 1440),
] as const;

export const SCREEN_SIZE_SETS = ["anchor", "full"] as const;

export type ScreenSizeSet = (typeof SCREEN_SIZE_SETS)[number];

export const SCREEN_SIZES: Readonly<Record<ScreenSizeSet, NonEmptyReadonlyArray<ScreenSize>>> = { anchor: ANCHOR, full: [...ANCHOR, ...NIGHTLY] };

export function screenSizeName({ device, width, height }: ScreenSize): string {
  return `${device}-${width}x${height}`;
}

export const ENLARGED_TEXT_PX = 32;
