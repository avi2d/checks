import type { PixelCrop } from "./keyboard-png.ts";

export type CropArgs = {
  readonly baseline: readonly PixelCrop[] | null;
  readonly focused: readonly PixelCrop[];
  readonly blurred: readonly PixelCrop[];
};

type CompareOutcome =
  | { readonly compared: true; readonly differs: boolean }
  | { readonly compared: false };

export const compareCrops = (args: CropArgs): CompareOutcome => {
  let before = false;
  let after = false;
  for (const [index, crop] of args.focused.entries()) {
    const blurred = args.blurred[index];
    const baseline = args.baseline?.[index];
    if (blurred === undefined || (args.baseline !== null && baseline === undefined)) return { compared: false };
    before ||= baseline !== undefined && !baseline.data.equals(crop.data);
    after ||= !crop.data.equals(blurred.data);
  }
  return { compared: true, differs: after && (args.baseline === null || before) };
};
