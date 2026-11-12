import { Effect, Schema } from "effect";

class PngFailure extends Schema.TaggedError<PngFailure>()("PngFailure", {
  message: Schema.String,
}) {}

export type Picture = { readonly width: number; readonly height: number; readonly rgb: Uint8Array };

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS_OF_COLOR_TYPE: Readonly<Partial<Record<number, number>>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

type Header = { readonly width: number; readonly height: number; readonly channels: number };

type Chunks = { readonly header: Header; readonly deflated: Uint8Array<ArrayBuffer> };

const chunksOf = (png: Uint8Array): Chunks | string => {
  if (!PNG_SIGNATURE.every((byte, at) => png[at] === byte)) return "it is not a PNG";
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const data: Uint8Array[] = [];
  let header: Header | string = "it has no IHDR chunk";
  for (let at = PNG_SIGNATURE.length; at + 8 <= png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") header = headerOf(new DataView(body.buffer, body.byteOffset, body.byteLength));
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  return typeof header === "string" ? header : { header, deflated: joined(data) };
};

const headerOf = (view: DataView): Header | string => {
  const [depth, colorType, interlace] = [view.getUint8(8), view.getUint8(9), view.getUint8(12)];
  const channels = CHANNELS_OF_COLOR_TYPE[colorType];
  if (depth !== 8 || channels === undefined || interlace !== 0) return `it is a ${String(depth)}-bit PNG of color type ${String(colorType)} with interlace ${String(interlace)}, and only 8-bit gray, RGB and RGBA without interlace decode`;
  return { width: view.getUint32(0), height: view.getUint32(4), channels };
};

const joined = (parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const whole = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  parts.reduce((at, part) => (whole.set(part, at), at + part.length), 0);
  return whole;
};

const paeth = (left: number, up: number, upLeft: number): number => {
  const [leftDistance, upDistance, upLeftDistance] = [Math.abs(up - upLeft), Math.abs(left - upLeft), Math.abs(left + up - 2 * upLeft)];
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
};

const PREDICTORS: readonly ((left: number, up: number, upLeft: number) => number)[] = [
  () => 0,
  (left) => left,
  (_left, up) => up,
  (left, up) => Math.floor((left + up) / 2),
  paeth,
];

type Row = { readonly filtered: Uint8Array; readonly raw: Uint8Array; readonly row: number; readonly stride: number; readonly channels: number };

const unfilterRow = ({ filtered, raw, row, stride, channels }: Row): string | undefined => {
  const predict = PREDICTORS[filtered[row * (stride + 1)] ?? 0];
  if (predict === undefined) return `row ${String(row)} names an unknown filter`;
  for (let at = 0; at < stride; at += 1) {
    const here = row * stride + at;
    const left = at < channels ? 0 : (raw[here - channels] ?? 0);
    const up = row === 0 ? 0 : (raw[here - stride] ?? 0);
    const upLeft = row === 0 || at < channels ? 0 : (raw[here - stride - channels] ?? 0);
    raw[here] = ((filtered[row * (stride + 1) + 1 + at] ?? 0) + predict(left, up, upLeft)) & 0xff;
  }
  return undefined;
};

const unfiltered = (filtered: Uint8Array, { width, height, channels }: Header): Uint8Array | string => {
  const stride = width * channels;
  if (filtered.length < height * (stride + 1)) return "its image data ends early";
  const raw = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const failed = unfilterRow({ filtered, raw, row, stride, channels });
    if (failed !== undefined) return failed;
  }
  return raw;
};

const rgbOf = (raw: Uint8Array, { width, height, channels }: Header): Uint8Array => {
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) rgb[pixel * 3 + channel] = raw[pixel * channels + (channels < 3 ? 0 : channel)] ?? 0;
  }
  return rgb;
};

const inflated = (deflated: Uint8Array<ArrayBuffer>) =>
  Effect.tryPromise({
    try: () => new Response(new Blob([deflated]).stream().pipeThrough(new DecompressionStream("deflate"))).bytes(),
    catch: (cause) => new PngFailure({ message: `its image data does not inflate: ${String(cause)}` }),
  });

export const decodePng = Effect.fn("decodePng")(function* (png: Uint8Array) {
  const chunks = chunksOf(png);
  if (typeof chunks === "string") return yield* new PngFailure({ message: chunks });
  const raw = unfiltered(yield* inflated(chunks.deflated), chunks.header);
  if (typeof raw === "string") return yield* new PngFailure({ message: raw });
  return { width: chunks.header.width, height: chunks.header.height, rgb: rgbOf(raw, chunks.header) } satisfies Picture;
});
