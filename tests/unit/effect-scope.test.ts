import { expect, test } from "bun:test";
import severities from "../../src/quality/presets/effect.language-service.json" with { type: "json" };
import { Schema } from "effect";
import kitTsconfig from "../../tsconfig.effect.json" with { type: "json" };
import { LANGUAGE_SERVICE, serviceOverrides, type ServiceOverride, withServiceOverrides } from "../../src/quality/effect-scope.ts";
import { type Step, withMember, withoutMember } from "../../src/quality/jsonc-patch.ts";
import { defineConfig, effectRules } from "../../src/quality/presets/oxlint.ts";

test("the language service takes the paths of the Effect override and nothing from the other overrides", () => {
  const { overrides = [] } = defineConfig({ effect: { files: ["src/**/*.ts"], excludeFiles: ["src/host/**"] } });
  expect(serviceOverrides(overrides)).toEqual([{ include: ["src/**/*.ts"], exclude: ["src/host/**"], options: severities }]);
});

test("an Effect override with nothing excluded writes no exclude, and effect: false writes no override", () => {
  expect(serviceOverrides([effectRules(["scripts/**/*.ts"])])).toEqual([{ include: ["scripts/**/*.ts"], options: severities }]);
  expect(serviceOverrides(defineConfig({ effect: false }).overrides ?? [])).toEqual([]);
});

const OVERRIDES = serviceOverrides([effectRules(["src/**/*.ts"])]);

const KIT_SEVERITY = kitTsconfig.compilerOptions.plugins[0]?.diagnosticSeverity;

const OVERRIDES_PATH: readonly [Step, ...Step[]] = ["compilerOptions", "plugins", { name: LANGUAGE_SERVICE }, "overrides"];

const TOKENS = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

const commentsOf = (text: string) => (text.match(TOKENS) ?? []).filter((token) => token.startsWith("/"));

function commented(tsconfig: string, written: string): string {
  expect(commentsOf(written)).toEqual(commentsOf(tsconfig));
  return written;
}

const rewritten = (tsconfig: string, overrides: readonly ServiceOverride[] = OVERRIDES) => commented(tsconfig, withServiceOverrides(tsconfig, overrides));

const pathsWritten = (tsconfig: string) => commented(tsconfig, withMember(tsconfig, OVERRIDES_PATH, OVERRIDES));

const pathsRemoved = (tsconfig: string) => commented(tsconfig, withoutMember(tsconfig, OVERRIDES_PATH));

function pluginsOf(tsconfig: string): unknown {
  const { compilerOptions } = Schema.decodeUnknownSync(Schema.Struct({ compilerOptions: Schema.Struct({ plugins: Schema.Unknown }) }))(Bun.JSONC.parse(tsconfig));
  return compilerOptions.plugins;
}

const indented = (indent: string) => JSON.stringify(OVERRIDES, null, 2).replaceAll("\n", `\n${indent}`);

test("stale overrides are replaced as one value, and every byte outside it stays", () => {
  const stale = `{\n  // kit paths\n  "compilerOptions": {\n    "plugins": [\n      { "name": "other" },\n      {\n        "name": "${LANGUAGE_SERVICE}", // the service\n        "overrides": [{ "include": ["old/**"] }], /* generated */\n        "diagnosticSeverity": { "floatingEffect": "error" },\n      },\n    ],\n  },\n}\n`;
  expect(pathsWritten(stale)).toBe(stale.replace('[{ "include": ["old/**"] }]', indented("        ")));
});

test("overrides that already hold the paths, in any key order or layout, are left as written", () => {
  const [held] = OVERRIDES;
  const reordered = JSON.stringify({ options: held?.options, include: held?.include });
  const tsconfig = `{ "compilerOptions": { "plugins": [{ "overrides": [${reordered}], "diagnosticSeverity": ${JSON.stringify(KIT_SEVERITY)}, "name": "${LANGUAGE_SERVICE}" }] } }`;
  expect(rewritten(tsconfig)).toBe(tsconfig);
  expect(rewritten(`{ "compilerOptions": {} }`, [])).toBe(`{ "compilerOptions": {} }`);
});

test("removed overrides take only their own text and comma, with the closer on their line or the next", () => {
  const plugin = (body: string) => `{ "compilerOptions": { "plugins": [${body}] } }`;
  const removed: readonly (readonly [string, string])[] = [
    [`{ "name": "${LANGUAGE_SERVICE}", // the service\n "overrides": [1] }`, `{ "name": "${LANGUAGE_SERVICE}" // the service\n }`],
    [`{ "name": "${LANGUAGE_SERVICE}", "overrides": [1] }`, `{ "name": "${LANGUAGE_SERVICE}" }`],
    [`{ "name": "${LANGUAGE_SERVICE}", "overrides": [1], "x": 1 }`, `{ "name": "${LANGUAGE_SERVICE}", "x": 1 }`],
    [`{\n  "name": "${LANGUAGE_SERVICE}", // the service\n  "overrides": [1]\n}`, `{\n  "name": "${LANGUAGE_SERVICE}" // the service\n}`],
    [`{\n  "name": "${LANGUAGE_SERVICE}", // the service\n  "overrides": [1],\n}`, `{\n  "name": "${LANGUAGE_SERVICE}", // the service\n}`],
    [`{\n  "name": "${LANGUAGE_SERVICE}",\n  "overrides": [1], // generated\n  // severities\n  "x": 1\n}`, `{\n  "name": "${LANGUAGE_SERVICE}",\n  // generated\n  // severities\n  "x": 1\n}`],
  ];
  for (const [before, after] of removed) {
    const written = pathsRemoved(plugin(before));
    expect(written).toBe(plugin(after));
    expect(pluginsOf(written)).toEqual([Object.fromEntries(Object.entries(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(Bun.JSONC.parse(before))).filter(([key]) => key !== "overrides"))]);
  }
});

test("missing overrides are added after the plugin's last member, and its comment stays on that member", () => {
  const service = `{\n  "compilerOptions": {\n    "plugins": [\n      {\n        "name": "${LANGUAGE_SERVICE}" // the service\n      }\n    ]\n  }\n}\n`;
  expect(pathsWritten(service)).toBe(service.replace("// the service", `// the service\n        "overrides": ${indented("        ")}`).replace(`"${LANGUAGE_SERVICE}"`, `"${LANGUAGE_SERVICE}",`));
  const inline = `{ "compilerOptions": { "plugins": [{ "name": "${LANGUAGE_SERVICE}", }] } }`;
  expect(pluginsOf(pathsWritten(inline))).toEqual([{ name: LANGUAGE_SERVICE, overrides: OVERRIDES }]);
});

test("a missing plugin, plugins list or compilerOptions is added the same way with the kit's severities, around the repository's own comments", () => {
  const added = [
    `{ "compilerOptions": { "plugins": [{ "name": "other" } /* other */] } }`,
    `{\n  "compilerOptions": {\n    "strict": true // strict\n  }\n}\n`,
    `{\n  // nothing yet\n}\n`,
    `{}`,
  ];
  const service = { ...kitTsconfig.compilerOptions.plugins[0], overrides: OVERRIDES };
  expect(service.name).toBe(LANGUAGE_SERVICE);
  expect(pluginsOf(rewritten(added[0] ?? ""))).toEqual([{ name: "other" }, service]);
  for (const tsconfig of added.slice(1)) expect(pluginsOf(rewritten(tsconfig))).toEqual([service]);
  expect(rewritten(added[1] ?? "")).toStartWith(`{\n  "compilerOptions": {\n    "strict": true, // strict\n    "plugins": [`);
});

test("this checkout's own language service entry holds the kit's severities beside its generated paths", async () => {
  const Entry = Schema.Struct({ name: Schema.String, diagnosticSeverity: Schema.optionalKey(Schema.Unknown) });
  const Own = Schema.Struct({ compilerOptions: Schema.Struct({ plugins: Schema.Array(Entry) }) });
  const own = Schema.decodeUnknownSync(Own)(Bun.JSONC.parse(await Bun.file(new URL("../../tsconfig.json", import.meta.url)).text()));
  const service = own.compilerOptions.plugins.find(({ name }) => name === LANGUAGE_SERVICE);
  expect(service?.diagnosticSeverity).toEqual(kitTsconfig.compilerOptions.plugins[0]?.diagnosticSeverity);
});

test("a release that changes or adds a kit severity rewrites it in an existing entry, and a key the repository added survives", () => {
  const { floatingEffect: _, ...withoutAdded } = KIT_SEVERITY ?? {};
  const stale = { ...withoutAdded, missingEffectError: "warning", effectFnOpportunity: "error" };
  const entry = (severity: unknown, overrides?: unknown) => ({ name: LANGUAGE_SERVICE, diagnosticSeverity: severity, ...(overrides === undefined ? {} : { overrides }) });
  const tsconfig = (severity: unknown, overrides?: unknown) => `${JSON.stringify({ compilerOptions: { plugins: [entry(severity, overrides)] } }, null, 2)}\n`;
  const refreshed = { ...KIT_SEVERITY, effectFnOpportunity: "error" };
  expect(pluginsOf(rewritten(tsconfig(stale, OVERRIDES)))).toEqual([entry(refreshed, OVERRIDES)]);
  expect(pluginsOf(rewritten(tsconfig(stale, OVERRIDES), []))).toEqual([entry(refreshed)]);
  expect(rewritten(tsconfig(refreshed, OVERRIDES))).toBe(tsconfig(refreshed, OVERRIDES));
  const bare = `{ "compilerOptions": { "plugins": [{ "name": "${LANGUAGE_SERVICE}" /* own */ }] } }`;
  expect(pluginsOf(rewritten(bare))).toEqual([{ name: LANGUAGE_SERVICE, diagnosticSeverity: KIT_SEVERITY, overrides: OVERRIDES }]);
});
