import { expect, test } from "bun:test";
import { compareCrops } from "../../../src/quality/browser/keyboard-crops.ts";

const element = () => {
  let pixels: ArrayLike<number> = [];
  const images = new WeakMap<object, Uint8Array>();
  class ImageBlob {
    readonly size: number;

    constructor(parts: readonly Uint8Array[]) {
      const data = parts[0] ?? new Uint8Array();
      this.size = data.length;
      images.set(this, data);
    }
  }
  const view = {
    devicePixelRatio: 1,
    atob,
    Blob: ImageBlob,
    createImageBitmap: (blob: { readonly size: number }) => {
      const bitmap = { close: () => {} };
      images.set(bitmap, images.get(blob) ?? new Uint8Array());
      return Promise.resolve(bitmap);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (bitmap: object) => { pixels = images.get(bitmap) ?? []; },
      getImageData: () => ({ data: pixels }),
    }),
  };
  return { ownerDocument: { defaultView: view, createElement: () => canvas } } satisfies Parameters<typeof compareCrops>[0];
};

const pixel = (red: number) => btoa(String.fromCharCode(red, 0, 0, 255));
const boxes = [{ x: 0, y: 0, width: 1, height: 1 }];

test("a page blur handler that paints after focus is not counted as a focus change", async () => {
  const before = pixel(0);
  const focused = pixel(0);
  const blurred = pixel(255);
  expect(await compareCrops(element(), { baseline: before, focused, blurred, boxes })).toEqual({ compared: true, differs: false });
});

test("a JavaScript focus ring removed by blur is counted rather than suppressed", async () => {
  const before = pixel(0);
  const focused = pixel(255);
  const blurred = pixel(0);
  expect(await compareCrops(element(), { baseline: before, focused, blurred, boxes })).toEqual({ compared: true, differs: true });
});

test("scroll-only paint that remains after blur is not counted as visible focus", async () => {
  expect(await compareCrops(element(), {
    baseline: pixel(0),
    focused: pixel(255),
    blurred: pixel(255),
    boxes,
  })).toEqual({ compared: true, differs: false });
});
