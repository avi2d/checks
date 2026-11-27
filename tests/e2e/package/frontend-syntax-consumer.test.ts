import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { CHECKOUT, ran } from "../lib/fixture-repo.ts";

const Manifest = Schema.fromJsonString(Schema.Struct({ peerDependencies: Schema.Record(Schema.String, Schema.String) }));

test("packed consumer detects invalid CSS without installing the kit's parser as a peer", async () => {
  const root = await mkdtemp(join(tmpdir(), "checks-frontend-consumer-"));
  try {
    const packed = await $`bun pm pack --destination ${root} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet();
    const manifest = Schema.decodeSync(Manifest)(await readFile(join(CHECKOUT, "package.json"), "utf8"));
    const names = ["effect", "postcss-html", "stylelint", "stylelint-config-standard", "stylelint-plugin-use-baseline"];
    const dependencies = { ...Object.fromEntries(names.map((name) => [name, manifest.peerDependencies[name]])), postcss: "^8.5.0" };
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "frontend-consumer", private: true, type: "module", dependencies: { ...dependencies, "@avi2dg/checks": `file:${packed.stdout.toString().trim()}` } }));
    await $`npm install --ignore-scripts --legacy-peer-deps --install-strategy=nested`.cwd(root).quiet();
    await writeFile(join(root, "checks.config.ts"), 'export default { frontendSyntax: { inputs: ["site.css"] } };\n');
    await writeFile(join(root, "stylelint.config.ts"), "export default { rules: {} };\n");
    const css = join(root, "site.css");
    const gate = join(root, "node_modules", ".bin", "checks-frontend-syntax");
    await writeFile(css, "a { transition: all 200ms; }\n");
    const red = await ran($`${gate}`.cwd(root));
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain('Disallowed value "all 200ms"');
    await writeFile(css, "a { transition: opacity 200ms; }\n");
    const green = await ran($`${gate}`.cwd(root));
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("frontend-syntax: no violation in 1 file(s)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
