import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-frontend-syntax-type-tokens-");

const GATE = "quality/frontend-syntax.ts";

const BUILDER = join(CHECKOUT, "dist", "presets", "stylelint.js");

function stylelintConfig(options: string): string {
  return `import { defineConfig } from ${JSON.stringify(BUILDER)};\n\nexport default defineConfig(${options});\n`;
}

const TYPE_TOKENS = ":root {\n  --leading: 1.3;\n  --tracking: 0.02em;\n  --weight: 600;\n  --case: uppercase;\n  --size: 1rem;\n}\n";

const TYPE_PROPERTIES = [
  { property: "line-height", literal: "1.3", token: "--leading" },
  { property: "letter-spacing", literal: "0.02em", token: "--tracking" },
  { property: "font-weight", literal: "600", token: "--weight" },
  { property: "text-transform", literal: "uppercase", token: "--case" },
] as const;

function typeRefusal(property: string, literal: string): string {
  return property === "font-weight"
    ? `Expected the font weight from the token files rather than the literal "${literal}" (checks/font-weight-from-tokens)`
    : `Disallowed value "${literal}" for property "${property}" (declaration-property-value-allowed-list)`;
}

function typeRepository(tokens: string, component: string) {
  return open({
    "frontend-syntax.json": JSON.stringify({ inputs: ["src/**/*.css"] }),
    "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/tokens.css"] }'),
    "src/tokens.css": tokens,
    "src/card.css": component,
  });
}

function rule(selector: string, declarations: readonly string[]): string {
  const custom = declarations.filter((declaration) => declaration.startsWith("--"));
  const standard = declarations.filter((declaration) => !declaration.startsWith("--"));
  const lines = (group: readonly string[]) => group.map((declaration) => `  ${declaration};\n`).join("");
  return `${selector} {\n${[custom, standard].filter((group) => group.length > 0).map(lines).join("\n")}}\n`;
}

const CLEAN = "frontend-syntax: no violation in 2 file(s) from 1 declared input(s)\n";

for (const { property, literal, token } of TYPE_PROPERTIES) {
  test(`a literal ${property} fails in a component file rather than passing as it does in a token file, and a var() passes`, async () => {
    const { write, script } = await typeRepository(`${TYPE_TOKENS}\n${rule(".lede", [`${property}: ${literal}`])}`, rule(".card", [`${property}: var(${token})`]));
    expect(await script(GATE)).toEqual({ exitCode: 0, text: CLEAN });

    await write({ "src/card.css": rule(".card", [`${property}: ${literal}`]) });
    const red = await script(GATE);
    expect(red.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/card.css:2:");
    expect(red.text).toContain(typeRefusal(property, literal));
    expect(red.exitCode).toBe(1);
  }, 60_000);
}

test("a font weight inside @font-face passes while a literal weight in an ordinary rule of the same file fails", async () => {
  const face = "@font-face {\n  font-family: Inter;\n  font-weight: 100 900;\n  src: url('inter.woff2');\n}\n";
  const { write, script } = await typeRepository(TYPE_TOKENS, face);
  expect(await script(GATE)).toEqual({ exitCode: 0, text: CLEAN });

  await write({ "src/card.css": `${face}\n${rule(".card", ["font-weight: 600"])}` });
  const red = await script(GATE);
  expect(red.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/card.css:");
  expect(red.text).toContain(typeRefusal("font-weight", "600"));
  expect(red.exitCode).toBe(1);
}, 60_000);

test("a type value a component file sets on its own custom property fails where the file reads it, while an alias of a token passes", async () => {
  const aliased = TYPE_PROPERTIES.map(({ property, token }) => rule(`.card-${property}`, [`--own: var(${token})`, `${property}: var(--own)`])).join("\n");
  const { write, script } = await typeRepository(TYPE_TOKENS, aliased);
  expect(await script(GATE)).toEqual({ exitCode: 0, text: CLEAN });

  await write({ "src/card.css": TYPE_PROPERTIES.map(({ property, literal }) => rule(`.card-${property}`, [`--own: ${literal}`, `${property}: var(--own)`])).join("\n") });
  const red = await script(GATE);
  expect(red.text).toStartWith("frontend-syntax: 4 problem(s) in 2 file(s) from 1 declared input(s):\n");
  for (const { property } of TYPE_PROPERTIES) expect(red.text).toContain(`Expected "--own" from the token files rather than set in this file (checks/${property}-from-tokens)`);
  expect(red.exitCode).toBe(1);
}, 60_000);

test("inherit, a normal letter spacing and no text transform pass, while a normal line height or weight, bold and a zero letter spacing fail", async () => {
  const kept = [
    rule(".inherited", TYPE_PROPERTIES.map(({ property }) => `${property}: inherit`)),
    rule(".reset", ["letter-spacing: normal", "text-transform: none"]),
  ].join("\n");
  const { write, script } = await typeRepository(TYPE_TOKENS, kept);
  expect(await script(GATE)).toEqual({ exitCode: 0, text: CLEAN });

  const refused = [
    rule(".leading", ["line-height: normal"]),
    rule(".regular", ["font-weight: normal"]),
    rule(".strong", ["font-weight: bold"]),
    rule(".tracking", ["letter-spacing: 0"]),
  ];
  await write({ "src/card.css": refused.join("\n") });
  const red = await script(GATE);
  expect(red.text).toStartWith("frontend-syntax: 4 problem(s) in 2 file(s) from 1 declared input(s):\n");
  for (const value of ['"normal" for property "line-height"', '"0" for property "letter-spacing"']) {
    expect(red.text).toContain(`Disallowed value ${value} (declaration-property-value-allowed-list)`);
  }
  for (const literal of ["normal", "bold"]) {
    expect(red.text).toContain(typeRefusal("font-weight", literal));
  }
  expect(red.exitCode).toBe(1);
}, 60_000);

test("the font shorthand fails a literal line height, a literal weight and a line height set in the same file, and passes a token line height", async () => {
  const { write, script } = await typeRepository(TYPE_TOKENS, rule(".card", ["font: var(--size)/var(--leading) serif"]));
  expect(await script(GATE)).toEqual({ exitCode: 0, text: CLEAN });

  for (const [component, reported] of [
    [rule(".card", ["font: var(--size)/1.3 serif"]), '"var(--size)/1.3 serif" for property "font" (declaration-property-value-allowed-list)'],
    [rule(".card", ["font: 600 var(--size) serif"]), '"600 var(--size) serif" for property "font" (declaration-property-value-allowed-list)'],
    [rule(".card", ["--own: 1.3", "font: var(--size)/var(--own) serif"]), 'Expected "--own" from the token files rather than set in this file (checks/line-height-from-tokens)'],
  ] as const) {
    await write({ "src/card.css": component });
    const red = await script(GATE);
    expect(red.text, component).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/card.css:");
    expect(red.text, component).toContain(reported);
    expect(red.exitCode, component).toBe(1);
  }
}, 60_000);