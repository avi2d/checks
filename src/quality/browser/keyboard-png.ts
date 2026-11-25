import type { Box } from "./keyboard-page.ts";
import type { Picture } from "./png.ts";

export type PixelCrop = { readonly data: Buffer };

export const cropPicture = (image: Picture, boxes: readonly Box[], scale: number): readonly PixelCrop[] =>
  boxes.map((box) => {
    const x = Math.floor(box.x * scale);
    const y = Math.floor(box.y * scale);
    const width = Math.ceil((box.x + box.width) * scale) - x;
    const height = Math.ceil((box.y + box.height) * scale) - y;
    const data = Buffer.alloc(width * height * 3);
    const copyWidth = Math.max(0, Math.min(width, image.width - x));
    const copyHeight = Math.max(0, Math.min(height, image.height - y));
    for (let row = 0; row < copyHeight; row += 1) {
      const start = ((y + row) * image.width + x) * 3;
      data.set(image.rgb.subarray(start, start + copyWidth * 3), row * width * 3);
    }
    return { data };
  });
