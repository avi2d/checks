import { expect, test } from "bun:test";
import { pinsOf, versionFindings } from "../../src/docs/doc-versions.ts";

const MANIFEST = JSON.stringify({
  version: "0.9.0",
  engines: { node: ">=22.18.0" },
  dependencies: { zod: "^4.1.0", effect: "workspace:*" },
  peerDependencies: { "html-validate": "11.16.0", "@axe-core/playwright": "4.13.0" },
});
const PINS = pinsOf(MANIFEST, "1.4.3\n");

function refusals(lines: readonly string[], within?: ReadonlySet<number>): readonly string[] {
  return versionFindings(lines.join("\n"), PINS, within).map(({ line, message }) => `${line}: ${message}`);
}

const INSTEAD = "instead, or let a build write the line between generated markers";

test("a hand-written copy of each kind of pin is refused, naming the file that holds it", () => {
  expect(
    refusals([
      "bun add -d html-validate@11.16.0 @axe-core/playwright@4.13.0",
      "Bun 1.4.3 runs every bin.",
      "Node 22.18.0 or newer.",
      "Pin zod@^4.1.0 here.",
      "Release v0.9.0 is out.",
    ]),
  ).toEqual([
    `1: carries \`html-validate@11.16.0\`, a version package.json pins. Name package.json ${INSTEAD}`,
    `1: carries \`@axe-core/playwright@4.13.0\`, a version package.json pins. Name package.json ${INSTEAD}`,
    `2: carries \`1.4.3\`, a version .bun-version pins. Name .bun-version ${INSTEAD}`,
    `3: carries \`22.18.0\`, a version package.json pins. Name package.json ${INSTEAD}`,
    `4: carries \`zod@^4.1.0\`, a version package.json pins. Name package.json ${INSTEAD}`,
    `5: carries \`v0.9.0\`, a version package.json pins. Name package.json ${INSTEAD}`,
  ]);
});

test("a version no manifest pins, or a longer one that opens with a pin, is no copy", () => {
  expect(refusals(["html-validate@11.17.0 and lodash@4.17.20", "Bun 1.4.30, 1.4.3-beta and 21.4.3 differ.", "effect@4.0.0 stays a sample."])).toEqual([]);
});

test("a named copy whose version is also a bare pin is refused once, as the named copy", () => {
  const pins = pinsOf(JSON.stringify({ devDependencies: { "@types/bun": "1.4.3" } }), "1.4.3");
  expect(versionFindings("bun add -d @types/bun@1.4.3", pins).map(({ message }) => message)).toEqual([
    `carries \`@types/bun@1.4.3\`, a version package.json pins. Name package.json ${INSTEAD}`,
  ]);
});

test("a complete same-named generated block is not judged, and the lines around it are", () => {
  const text = [
    "---",
    "pinned: 1.4.3",
    "---",
    "<!-- generated install: bun run build writes it from package.json -->",
    "bun add -d html-validate@11.16.0",
    "<!-- end generated install -->",
    "Bun 1.4.3 runs it.",
  ];
  expect(refusals(text)).toEqual([
    `2: carries \`1.4.3\`, a version .bun-version pins. Name .bun-version ${INSTEAD}`,
    `7: carries \`1.4.3\`, a version .bun-version pins. Name .bun-version ${INSTEAD}`,
  ]);
});

test("a prose or table copy beside the name is refused", () => {
  const pins = pinsOf(JSON.stringify({ peerDependencies: { typescript: "7.0.2" } }), "");
  const found = (lines: readonly string[]): readonly string[] =>
    versionFindings(lines.join("\n"), pins).map(({ line, message }) => `${line}: ${message}`);
  expect(found(["TypeScript 7.0.2 guides the setup."])).toEqual([
    `1: carries \`7.0.2\`, a version package.json pins. Name package.json ${INSTEAD}`,
  ]);
  expect(found(["| typescript | 7.0.2 |"])).toEqual([`1: carries \`7.0.2\`, a version package.json pins. Name package.json ${INSTEAD}`]);
});

test("a bare number that names no dependency is no copy", () => {
  const pins = pinsOf(JSON.stringify({ peerDependencies: { typescript: "7.0.2" } }), "");
  expect(versionFindings("The budget is 7.0.2 million", pins)).toEqual([]);
});

test("front matter that copies a pinned version is refused", () => {
  const text = ["---", "description: Requires Bun 1.4.3", "---", "Bun guides the setup."];
  expect(refusals(text)).toEqual([`2: carries \`1.4.3\`, a version .bun-version pins. Name .bun-version ${INSTEAD}`]);
});

test("an opening marker without its closing marker judges the lines after it", () => {
  const text = ["<!-- generated install: bun run build writes it from package.json -->", "Bun 1.4.3 runs it."];
  expect(refusals(text)).toEqual([`2: carries \`1.4.3\`, a version .bun-version pins. Name .bun-version ${INSTEAD}`]);
});

test("a closing marker with another name judges the block", () => {
  const text = [
    "<!-- generated install: bun run build writes it from package.json -->",
    "Bun 1.4.3 runs it.",
    "<!-- end generated gates -->",
  ];
  expect(refusals(text)).toEqual([`2: carries \`1.4.3\`, a version .bun-version pins. Name .bun-version ${INSTEAD}`]);
});

test("a marker inside a fenced example neither opens a block nor is judged as a marker", () => {
  const text = ["```md", "<!-- generated install: bun run build writes it from package.json -->", "```", "Bun 1.4.3 runs it."];
  expect(refusals(text)).toEqual([`4: carries \`1.4.3\`, a version .bun-version pins. Name .bun-version ${INSTEAD}`]);
});

test("only the lines a change adds or edits are judged", () => {
  expect(refusals(["Bun 1.4.3 runs it.", "zod@4.1.0 decodes it."], new Set([2]))).toEqual([
    `2: carries \`zod@4.1.0\`, a version package.json pins. Name package.json ${INSTEAD}`,
  ]);
});

test("a range with no single version and a package.json that does not decode pin nothing", () => {
  expect(pinsOf(JSON.stringify({ dependencies: { a: ">=1.2.3 <2.0.0", b: "latest", c: "npm:d@1.0.0" } }), "")).toEqual([]);
  expect(pinsOf("{ not json", "")).toEqual([]);
});
