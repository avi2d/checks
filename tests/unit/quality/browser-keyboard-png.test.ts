import { expect, test } from "bun:test";
import { PNG } from "pngjs";
import { cropPng, type PixelCrop } from "../../../src/quality/browser/keyboard-png.ts";

const source = () => {
  const image = new PNG({ width: 4, height: 3 });
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = x + y * 4;
      image.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(image);
};

const box = [{ x: 1, y: 1, width: 2, height: 1 }];

const assertCrop = (crop: PixelCrop) => {
  expect([...crop.data]).toEqual([5, 0, 0, 255, 6, 0, 0, 255]);
};

test("the crop oracle rejects a cropper that returns the full screenshot", () => {
  const wrongCrop = (image: Buffer) => PNG.sync.read(image);
  expect(() => assertCrop(wrongCrop(source()))).toThrow();
});

test("the screenshot crop does not include pixels outside the selected rectangle", () => {
  const [crop] = cropPng(source(), box, 1);
  expect(crop).toBeDefined();
  if (crop !== undefined) assertCrop(crop);
});
