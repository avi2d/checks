import { expect, test } from "bun:test";
import { UNSCOPED, SCOPE_SERVICE, KIT_SERVICE, PLANT, ASYNC_PLANT, scopeConsumer } from "../lib/effect-scope-consumer.ts";

const { tree, consumer, oxlint, diagnostics, scopeGate, expectAsyncPaths } = scopeConsumer("checks-effect-scope-severity-");

test("scope generation does not certify async diagnostics that disagree with ordered oxlint overrides", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
const config = defineConfig({
  effect: { files: ["scripts/**/*.ts"], excludeFiles: ["scripts/excluded.ts"] },
  overrides: [
    { files: ["scripts/host/**"], excludeFiles: ["scripts/host/pass.ts"], rules: { "oxc/no-async-await": "off" } },
    { files: ["scripts/host/again.ts"], rules: { "oxc/no-async-await": ["error"] } },
  ],
});
export default {
  ...config,
  overrides: config.overrides.map((override) => override.rules?.["effect-channel/no-try-catch"] === "error"
    ? { ...override, rules: { ...Object.fromEntries(Object.entries(override.rules).reverse()), "eslint/no-debugger": "error" } }
    : override),
};
`);
  const positive = ["scripts/main.ts", "scripts/host/again.ts", "scripts/host/pass.ts"];
  for (const path of [...positive, "scripts/host/off.ts", "scripts/excluded.ts", UNSCOPED]) await tree.put(path, ASYNC_PLANT);
  const generated = await scopeGate();
  expect(generated.exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(positive);
  const diagnosed = await diagnostics();
  expect(diagnosed.get("scripts/host/off.ts")).toContain("newPromise");
  expect(diagnosed.get(UNSCOPED)).toContain("anyUnknownInErrorContext");
}, 180_000);

test("allow and deny do not leave paired diagnostics at an earlier override severity", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({
  effect: false,
  rules: { "oxc/no-async-await": "deny" },
  overrides: [
    { files: ["scripts/host/**"], rules: { "oxc/no-async-await": ["allow"], "promise/avoid-new": "deny" } },
    { files: ["scripts/host/again.ts"], rules: { "oxc/no-async-await": "deny", "promise/avoid-new": "allow" } },
  ],
});
`);
  for (const file of ["scripts/a.ts", "scripts/host/off.ts", "scripts/host/again.ts"]) await tree.put(file, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(["scripts/a.ts", "scripts/host/again.ts"]);
  const { linted } = await oxlint([]);
  const diagnosed = await diagnostics();
  for (const file of ["scripts/a.ts", "scripts/host/off.ts", "scripts/host/again.ts"]) {
    const expected = file === "scripts/host/off.ts";
    expect((linted.get(file) ?? []).includes("promise(avoid-new)")).toBe(expected);
    expect((diagnosed.get(file) ?? []).includes("newPromise")).toBe(expected);
  }
}, 180_000);

test("unsupported scoped severities and active categories cannot be certified as current", async () => {
  for (const extra of [
    'rules: { "oxc/no-async-await": "invalid" }',
    'overrides: [{ files: ["scripts/**"], rules: { "promise/avoid-new": [] } }]',
    'overrides: [{ files: ["scripts/**"], rules: { "node/no-sync": null } }]',
    'categories: { restriction: "deny" }',
    'categories: { style: "invalid" }',
  ]) {
    await consumer();
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default { ...defineConfig({ effect: true }), ${extra} };
`);
    for (const args of [[], ["--check"]]) expect((await scopeGate(...args)).exitCode).toBe(2);
  }
}, 180_000);

test("all six rules off does not leave unpaired diagnostics enabled or block later re-enabling", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig, effectRules } from "@avi2dg/checks/oxlint";
const off = effectRules(["scripts/host/**"]);
export default defineConfig({
  effect: { files: ["scripts/**/*.ts"] },
  overrides: [
    { ...off, rules: Object.fromEntries(Object.keys(off.rules).map((rule) => [rule, "allow"])) },
    effectRules(["scripts/host/again.ts"]),
  ],
});
`);
  const active = ["scripts/a.ts", "scripts/host/again.ts"];
  for (const file of [...active, "scripts/host/off.ts", UNSCOPED]) await tree.put(file, PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(active);
  const diagnosed = await diagnostics();
  for (const file of active) expect(diagnosed.get(file)).toEqual(expect.arrayContaining(SCOPE_SERVICE));
  for (const file of ["scripts/host/off.ts", UNSCOPED]) {
    for (const rule of SCOPE_SERVICE) expect(diagnosed.get(file) ?? []).not.toContain(rule);
    expect(diagnosed.get(file)).toEqual(expect.arrayContaining(KIT_SERVICE));
  }
}, 180_000);
