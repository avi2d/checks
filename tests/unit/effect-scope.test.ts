import { expect, test } from "bun:test";
import severities from "../../src/quality/presets/effect.language-service.json" with { type: "json" };
import { LANGUAGE_SERVICE, serviceOverrides, withServiceOverrides } from "../../src/quality/effect-scope.ts";
import { patched } from "../../src/quality/jsonc-patch.ts";
import { defineConfig, effectRules } from "../../src/quality/presets/oxlint.ts";

test("the language service takes the paths of the Effect override and nothing from the other overrides", () => {
  const { overrides = [] } = defineConfig({ effect: { files: ["src/**/*.ts"], excludeFiles: ["src/host/**"] } });
  expect(serviceOverrides(overrides)).toEqual([{ include: ["src/**/*.ts"], exclude: ["src/host/**"], options: severities }]);
});

test("an Effect override with nothing excluded writes no exclude, and effect: false writes no override", () => {
  expect(serviceOverrides([effectRules(["scripts/**/*.ts"])])).toEqual([{ include: ["scripts/**/*.ts"], options: severities }]);
  expect(serviceOverrides(defineConfig({ effect: false }).overrides ?? [])).toEqual([]);
});

test("the overrides replace the language service's own and keep its other keys and every other plugin", () => {
  const overrides = serviceOverrides([effectRules(["src/**/*.ts"])]);
  const other = { name: "other-plugin", strict: true };
  const stale = { name: LANGUAGE_SERVICE, diagnosticSeverity: { floatingEffect: "error" }, overrides: [{ include: ["old/**"] }] };
  expect(withServiceOverrides([other, stale], overrides)).toEqual([other, { name: LANGUAGE_SERVICE, diagnosticSeverity: { floatingEffect: "error" }, overrides }]);
});

test("a tsconfig without the language service gains it only when there is a path to hold, and loses its overrides when there is none", () => {
  const overrides = serviceOverrides([effectRules(["src/**/*.ts"])]);
  expect(withServiceOverrides([], overrides)).toEqual([{ name: LANGUAGE_SERVICE, overrides }]);
  const none: readonly Readonly<Record<string, unknown>>[] = [];
  expect(withServiceOverrides(none, [])).toBe(none);
  expect(withServiceOverrides([{ name: LANGUAGE_SERVICE, overrides }], [])).toEqual([{ name: LANGUAGE_SERVICE }]);
});

const COMMENTED = `{
  // kept
  "compilerOptions": {
    "strict": true, /* kept too */
    "plugins": [{ "name": "a" }, { "name": "b", "overrides": [1, 2], "x": 'y' },],
  },
}
`;

test("a patch rewrites only the values that differ and keeps the comments, quotes and trailing commas around them", () => {
  const next = { compilerOptions: { strict: true, plugins: [{ name: "a" }, { name: "b", overrides: [1, 3], x: "y" }] } };
  expect(patched(COMMENTED, next)).toBe(COMMENTED.replace("[1, 2]", "[1, 3]"));
  expect(patched(COMMENTED, Bun.JSONC.parse(COMMENTED))).toBe(COMMENTED);
});

test("a patch drops a removed member with its comma and appends an added one in the container's own layout", () => {
  const dropped = { compilerOptions: { strict: true, plugins: [{ name: "a" }, { name: "b", x: "y" }] } };
  expect(patched(COMMENTED, dropped)).toBe(COMMENTED.replace(` "overrides": [1, 2],`, ""));
  const appended = { compilerOptions: { strict: true, plugins: [{ name: "a" }, { name: "b", overrides: [1, 2], x: "y" }, { name: "c" }] } };
  expect(patched(COMMENTED, appended)).toBe(COMMENTED.replace(`'y' }`, `'y' }, {\n      "name": "c"\n    }`));
  const added = { compilerOptions: { strict: true, plugins: [{ name: "a" }, { name: "b", overrides: [1, 2], x: "y" }] }, include: ["src"] };
  expect(patched(COMMENTED, added)).toBe(COMMENTED.replace("  },\n}", '  },\n  "include": [\n    "src"\n  ],\n}'));
});

test("a patch fills an empty container on lines of its own and replaces one whose every member changes", () => {
  expect(patched('{ "a": {} }', { a: { b: 1 } })).toBe('{ "a": {\n  "b": 1\n} }');
  expect(patched('{\n  "a": { "b": 1 }\n}\n', { a: { c: 2 } })).toBe('{\n  "a": {\n    "c": 2\n  }\n}\n');
  expect(patched('{ "a": [1, 2, 3] }', { a: [1] })).toBe('{ "a": [1] }');
  expect(patched('{ "a": [1, 2] }', { a: [] })).toBe('{ "a": [] }');
});

test("a patch that drops members keeps every comment beside them and the layout of what stays", () => {
  const service = '{\n  "name": "s", // the service\n  "overrides": [1]\n}';
  expect(patched(service, { name: "s" })).toBe('{\n  "name": "s" // the service\n}');
  const middle = '{\n  "name": "s", // the service\n  "overrides": [1],\n  // severities\n  "x": 1\n}';
  expect(patched(middle, { name: "s", x: 1 })).toBe('{\n  "name": "s", // the service\n  // severities\n  "x": 1\n}');
  const trailing = '{\n  "name": "s", // the service\n  "overrides": [1],\n}';
  expect(patched(trailing, { name: "s" })).toBe('{\n  "name": "s", // the service\n}');
  expect(patched('[\n  "a", // kept\n  "b",\n  "c"\n]', ["a"])).toBe('[\n  "a" // kept\n]');
  expect(patched('{ "a": 1, "b": 2, }', { a: 1, c: 3 })).toBe('{ "a": 1, "c": 3, }');
  expect(patched('{ "a": 1, "b": 2 }', { a: 1, c: 3 })).toBe('{ "a": 1, "c": 3 }');
});
