import { expect, test } from "bun:test";
import severities from "../../src/quality/presets/effect.language-service.json" with { type: "json" };
import { LANGUAGE_SERVICE, serviceOverrides, withServiceOverrides } from "../../src/quality/effect-scope.ts";
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
