import { Schema } from "effect";
import type { PageBitmap, PageElement } from "./keyboard-page.ts";
import type { PixelCrop } from "./keyboard-png.ts";

export type CropArgs = {
  readonly baseline: readonly PixelCrop[] | null;
  readonly focused: readonly PixelCrop[];
  readonly blurred: readonly PixelCrop[];
};

const CompareOutcomeSchema = Schema.Union([
  Schema.Struct({ compared: Schema.Literal(true), differs: Schema.Boolean }),
  Schema.Struct({ compared: Schema.Literal(false) }),
]);

type CompareOutcome = typeof CompareOutcomeSchema.Type;

type CropElement = {
  readonly ownerDocument: {
    readonly defaultView: Pick<PageElement["ownerDocument"]["defaultView"], "atob" | "createImageBitmap" | "Blob">;
    readonly createElement: PageElement["ownerDocument"]["createElement"];
  };
};

export const compareCrops = (el: CropElement, args: CropArgs): Promise<CompareOutcome> => {
  const view = el.ownerDocument.defaultView;
  const unreadable: CompareOutcome = { compared: false };
  const decode = (raw: string): Promise<PageBitmap> => {
    const binary = view.atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return view.createImageBitmap(new view.Blob([bytes], { type: "image/png" }));
  };
  const pixelsOf = (shot: PageBitmap, crop: PixelCrop): ArrayLike<number> | null => {
    const canvas = el.ownerDocument.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(shot, 0, 0, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return context.getImageData(0, 0, crop.width, crop.height).data;
  };
  const compare = (first: ArrayLike<number>, second: ArrayLike<number>): boolean => {
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] !== second[index]) return true;
    }
    return false;
  };
  return Promise.all(args.focused.map((crop, index) => {
    const blurredCrop = args.blurred[index];
    const baselineCrop = args.baseline?.[index];
    if (blurredCrop === undefined || (args.baseline !== null && baselineCrop === undefined)) return Promise.resolve(null);
    return Promise.all([
      baselineCrop === undefined ? Promise.resolve(null) : decode(baselineCrop.image),
      decode(crop.image),
      decode(blurredCrop.image),
    ]).then(([baseline, focused, blurred]) => {
      const before = baseline === null ? null : pixelsOf(baseline, crop);
      const during = pixelsOf(focused, crop);
      const after = pixelsOf(blurred, crop);
      baseline?.close();
      focused.close();
      blurred.close();
      if (during === null || after === null || (baseline !== null && before === null)) return null;
      return { before: before !== null && compare(before, during), after: compare(during, after) };
    });
  })).then((results) => {
    if (results.some((result) => result === null)) return unreadable;
    const differs = results.some((result) => result?.after === true) &&
      (args.baseline === null || results.some((result) => result?.before === true));
    return { compared: true, differs };
  });
};

export const decodeOutcome = Schema.decodeUnknownEffect(CompareOutcomeSchema);
