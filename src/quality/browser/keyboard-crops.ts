import type { PixelCrop } from "./keyboard-png.ts";

export type CropArgs = {
  readonly baseline: readonly PixelCrop[] | null;
  readonly focused: readonly PixelCrop[];
  readonly blurred: readonly PixelCrop[];
};

const differs = (first: readonly PixelCrop[], second: readonly PixelCrop[]): boolean =>
  first.some((crop, index) => {
    const other = second[index];
    return other !== undefined && !crop.data.equals(other.data);
  });

export const compareCrops = (args: CropArgs): boolean =>
  differs(args.focused, args.blurred) && (args.baseline === null || differs(args.baseline, args.focused));
