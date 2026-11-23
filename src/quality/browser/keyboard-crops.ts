import { Schema } from "effect";
import type { Box, PageBitmap, PageElement } from "./keyboard-page.ts";

export type CropArgs = {
  readonly first: string;
  readonly second: string;
  readonly boxes: readonly Box[];
};

type FocusCaptures = { readonly baseline: string; readonly focused: string; readonly blurred: string };

export const focusCrops = ({ baseline, focused }: FocusCaptures, boxes: readonly Box[]): CropArgs => ({
  first: baseline,
  second: focused,
  boxes,
});

const CompareOutcomeSchema = Schema.Union([
  Schema.Struct({ compared: Schema.Literal(true), differs: Schema.Boolean }),
  Schema.Struct({ compared: Schema.Literal(false) }),
]);

type CompareOutcome = typeof CompareOutcomeSchema.Type;

type CropElement = {
  readonly ownerDocument: {
    readonly defaultView: Pick<PageElement["ownerDocument"]["defaultView"], "devicePixelRatio" | "atob" | "createImageBitmap" | "Blob">;
    readonly createElement: PageElement["ownerDocument"]["createElement"];
  };
};

export const compareCrops = (el: CropElement, args: CropArgs): Promise<CompareOutcome> => {
  const view = el.ownerDocument.defaultView;
  const scale = view.devicePixelRatio || 1;
  const unreadable: CompareOutcome = { compared: false };
  const changed: CompareOutcome = { compared: true, differs: true };
  const same: CompareOutcome = { compared: true, differs: false };
  const decode = (raw: string): Promise<PageBitmap> => {
    const binary = view.atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return view.createImageBitmap(new view.Blob([bytes], { type: "image/png" }));
  };
  const pixelsOf = (shot: PageBitmap, box: Box): ArrayLike<number> | null => {
    const left = Math.floor(box.x * scale);
    const top = Math.floor(box.y * scale);
    const width = Math.ceil((box.x + box.width) * scale) - left;
    const height = Math.ceil((box.y + box.height) * scale) - top;
    const canvas = el.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(shot, left, top, width, height, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  const compareBox = (first: PageBitmap, second: PageBitmap, box: Box): CompareOutcome => {
    const before = pixelsOf(first, box);
    const after = pixelsOf(second, box);
    if (before === null || after === null) return unreadable;
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] !== after[index]) return changed;
    }
    return same;
  };
  const compareBoxes = (first: PageBitmap, second: PageBitmap): CompareOutcome => {
    for (const box of args.boxes) {
      const result = compareBox(first, second, box);
      if (!result.compared || result.differs) return result;
    }
    return same;
  };
  return Promise.all([decode(args.first), decode(args.second)]).then(([first, second]) => {
    const result = compareBoxes(first, second);
    first.close();
    second.close();
    return result;
  });
};

export const decodeOutcome = Schema.decodeUnknownEffect(CompareOutcomeSchema);
