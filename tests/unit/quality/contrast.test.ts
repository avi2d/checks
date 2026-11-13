import { expect, test } from "bun:test";
import { needsOf, readBox, verdicts, type Shots, type TextBox } from "../../../src/quality/browser/contrast.ts";
import type { Picture } from "../../../src/quality/browser/png.ts";

type Rgb = readonly [number, number, number];

const WIDTH = 40;
const HEIGHT = 12;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const MARKER: Rgb = [0, 255, 0];

const picture = (colorAt: (x: number, y: number) => Rgb): Picture => {
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) rgb.set(colorAt(x, y), (y * WIDTH + x) * 3);
  return { width: WIDTH, height: HEIGHT, rgb };
};

const isGlyph = (x: number, y: number): boolean => x >= 10 && x < 30 && y >= 4 && y < 8;

const shots = (text: Rgb, backdropAt: (x: number, y: number) => Rgb): Shots => ({
  drawn: picture((x, y) => (isGlyph(x, y) ? text : backdropAt(x, y))),
  glyphs: picture((x, y) => (isGlyph(x, y) ? MARKER : backdropAt(x, y))),
  backdrop: picture(backdropAt),
});

const BOX: TextBox = { target: "heading", text: "Hello", sizePx: 16, box: 1, left: 0, top: 0, width: WIDTH, height: HEIGHT };

const ratioOf = (text: Rgb, backdropAt: (x: number, y: number) => Rgb, box = BOX): number | null => readBox(shots(text, backdropAt), box).ratio;

test("black letters on white read 21:1, the ceiling of the ratio, not a value scaled by the share of letter pixels", () => {
  expect(ratioOf(BLACK, () => WHITE)).toBeCloseTo(21, 5);
});

test("#767676 on white reads 4.54:1 and passes body text, while #777777 reads 4.48:1 and fails it, so the gamma curve is not skipped", () => {
  const [passing, failing] = [ratioOf([0x76, 0x76, 0x76], () => WHITE), ratioOf([0x77, 0x77, 0x77], () => WHITE)];
  expect(passing).toBeCloseTo(4.54, 2);
  expect(failing).toBeCloseTo(4.48, 2);
  expect(verdicts([{ name: "heading", selector: "h1", contrast: true }], [{ ...BOX, needs: needsOf(16), ratio: failing }]).found).toEqual([
    'heading "Hello" box 1 reads at 4.48:1, needs 4.5:1',
  ]);
});

test("white letters read against the bright stretch of a striped backdrop, not against the average of the stripes", () => {
  const striped = (x: number): Rgb => (x < 26 ? BLACK : WHITE);
  expect(ratioOf(WHITE, striped)).toBeCloseTo(1, 5);
});

test("the ratio is the same whichever of letters and backdrop is lighter, so dark text on light is not read inverted", () => {
  const [dark, light] = [ratioOf(BLACK, () => [200, 200, 200]), ratioOf([200, 200, 200], () => BLACK)];
  expect(dark).not.toBeNull();
  expect(dark).toBeCloseTo(light ?? 0, 5);
});

test("a box whose letters the marker never reaches has no ratio, rather than reading as a pass", () => {
  const unmarked: Shots = { drawn: picture(() => WHITE), glyphs: picture(() => WHITE), backdrop: picture(() => WHITE) };
  const reading = readBox(unmarked, BOX);
  expect(reading.ratio).toBeNull();
  expect(verdicts([{ name: "heading", selector: "h1", contrast: true }], [reading]).found).toEqual(['heading "Hello" box 1 draws no glyph to measure']);
});

test("a target with no text box on screen fails, rather than passing with nothing measured", () => {
  const { found, inventory } = verdicts([{ name: "note", selector: ".note", contrast: true }], []);
  expect(found).toEqual(["note (.note) shows no text on screen to measure"]);
  expect(inventory).toEqual(["note 0 text box(es)"]);
});

test("a box outside the capture is clipped to it, rather than reading pixels past the edge", () => {
  expect(ratioOf(BLACK, () => WHITE, { ...BOX, left: -5, top: -5, width: WIDTH + 10, height: HEIGHT + 10 })).toBeCloseTo(21, 5);
});

test("text from 24px needs 3:1 and smaller text 4.5:1, so 18pt large text is not held to the body ratio", () => {
  expect(needsOf(24)).toBe(3);
  expect(needsOf(23.9)).toBe(4.5);
});
