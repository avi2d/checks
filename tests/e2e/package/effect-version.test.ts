import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { CHECKOUT } from "../lib/fixture-repo.ts";

const KitManifest = Schema.fromJsonString(Schema.Struct({ peerDependencies: Schema.Struct({ effect: Schema.String }) }));
const EffectManifest = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

test("packed bin reports incompatible Effect instead of a missing runtime module", async () => {
  const root = await mkdtemp(join(tmpdir(), "checks-effect-version-"));
  try {
    const packed = await $`bun pm pack --destination ${root} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet();
    const manifest = Schema.decodeSync(KitManifest)(await Bun.file(join(CHECKOUT, "package.json")).text());
    const required = manifest.peerDependencies.effect;
    for (const version of ["4.0.0", required]) {
      const dir = join(root, version);
      await Bun.write(join(dir, "package.json"), JSON.stringify({
        name: "effect-version-consumer",
        private: true,
        scripts: { test: "checks-test", "test:fast": "checks-test --changed", lint: "checks-lint" },
        dependencies: { "@avi2dg/checks": `file:${packed.stdout.toString().trim()}`, effect: version },
      }));
      await $`bun install --ignore-scripts`.cwd(dir).quiet();
      await Bun.write(join(dir, ".gitignore"), "node_modules/\n");
      await Bun.write(join(dir, "bunfig.toml"), Bun.file(join(dir, "node_modules/@avi2dg/checks/bunfig.toml")));
      await $`git init -q`.cwd(dir).quiet();
      const resolved = Schema.decodeSync(EffectManifest)(await Bun.file(Bun.resolveSync("effect/package.json", join(dir, "node_modules/@avi2dg/checks/src/core/native-launch.ts"))).text());
      expect(resolved.version).toBe(version);
      const result = await $`${join(dir, "node_modules/.bin/checks-test-layout")}`.cwd(dir).nothrow().quiet();
      const output = result.stdout.toString() + result.stderr.toString();
      if (version !== required) {
        expect(result.exitCode).not.toBe(0);
        expect(output).toContain(`requires effect ${required}`);
        expect(output).toContain(`found ${version}`);
        expect(output).not.toContain("Cannot find module");
      } else {
        expect(result.exitCode).toBe(0);
        expect(output).toContain("test-layout:");
        expect(output).not.toContain("requires effect");
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
