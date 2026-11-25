import { PNG } from "pngjs";
import type { Box } from "./keyboard-page.ts";

export type PixelCrop = Readonly<Pick<PNG, "data" | "width" | "height">>;

export const cropPng = (source: Buffer, boxes: readonly Box[], scale: number): readonly PixelCrop[] => {
  const image = PNG.sync.read(source);
  return boxes.map((box) => {
    const x = Math.floor(box.x * scale);
    const y = Math.floor(box.y * scale);
    const width = Math.ceil((box.x + box.width) * scale) - x;
    const height = Math.ceil((box.y + box.height) * scale) - y;
    const crop = new PNG({ width, height });
    const copyWidth = Math.max(0, Math.min(width, image.width - x));
    const copyHeight = Math.max(0, Math.min(height, image.height - y));
    if (copyWidth > 0 && copyHeight > 0) PNG.bitblt(image, crop, x, y, copyWidth, copyHeight, 0, 0);
    return { data: crop.data, width, height };
  });
};
