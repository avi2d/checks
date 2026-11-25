import { expect, test } from "bun:test";
import { cropPicture, type PixelCrop } from "../../../src/quality/browser/keyboard-png.ts";
import type { Picture } from "../../../src/quality/browser/png.ts";

const source = (): Picture => {
  const image = { width: 4, height: 3, rgb: new Uint8Array(4 * 3 * 3) };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 3;
      image.rgb[offset] = x + y * 4;
    }
  }
  return image;
};

const box = [{ x: 1, y: 1, width: 2, height: 1 }];

const assertCrop = (crop: PixelCrop) => {
  expect([...crop.data]).toEqual([5, 0, 0, 6, 0, 0]);
};

test("the crop oracle rejects a cropper that returns the full screenshot", () => {
  const wrongCrop = (image: Picture) => ({ data: Buffer.from(image.rgb) });
  expect(() => assertCrop(wrongCrop(source()))).toThrow();
});

test("the screenshot crop does not include pixels outside the selected rectangle", () => {
  const [crop] = cropPicture(source(), box, 1);
  expect(crop).toBeDefined();
  if (crop !== undefined) assertCrop(crop);
});
