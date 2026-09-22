import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const BASE = join(CHECKOUT, "dependency-cruiser.config.js");

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function depcruise(config: string, ...targets: string[]): Promise<{ exitCode: number; text: string }> {
  const binary = join(CHECKOUT, "node_modules", ".bin", "depcruise");
  const result = await $`${binary} --config ${config} ${targets}`.cwd(dir).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

async function writeConfig(extraForbidden: unknown[] = []): Promise<string> {
  const path = join(dir, ".dependency-cruiser.cjs");
  await writeFile(
    path,
    `module.exports = { extends: ${JSON.stringify(BASE)}, forbidden: ${JSON.stringify(extraForbidden)} };\n`,
  );
  return path;
}

async function writeProject(files: Record<string, string>): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "checks-depcruiser-fixture", type: "module" }));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}

test(
  "no-circular goes red naming the cycle, green once the back edge is gone",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-circular-"));
    await writeProject({
      "src/entry.test.ts": `import "./entry.ts";\n`,
      "src/entry.ts": `import "./helper.ts";\nexport const entry: number = 1;\n`,
      "src/helper.ts": `import "./entry.ts";\nexport const helper: number = 1;\n`,
    });
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("no-circular");

    await writeFile(join(dir, "src/helper.ts"), `export const helper: number = 1;\n`);
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "no-orphans goes red naming the unreachable module, green once it is used",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-orphans-"));
    await writeProject({
      "src/entry.test.js": `import "./entry.js";\n`,
      "src/entry.js": `export const entry = 1;\n`,
      "src/lonely.js": `export const lonely = 1;\n`,
    });
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("no-orphans");
    expect(red.text).toContain("lonely.js");

    await writeFile(join(dir, "src/entry.js"), `import "./lonely.js";\nexport const entry = 1;\n`);
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "not-to-dev-dep goes red on a runtime dev import, green once the package is also a peer, green once it is local",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-devdep-"));
    await writeProject({
      "src/entry.test.js": `import "./entry.js";\n`,
      "src/entry.js": `import { dev } from "fake-dev";\nexport const entry = dev;\n`,
    });
    const manifest = async (extra: Record<string, unknown>): Promise<void> => {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "checks-depcruiser-fixture",
          type: "module",
          devDependencies: { "fake-dev": "1.0.0" },
          ...extra,
        }),
      );
    };
    await manifest({});
    await mkdir(join(dir, "node_modules", "fake-dev"), { recursive: true });
    await writeFile(join(dir, "node_modules", "fake-dev", "package.json"), JSON.stringify({ name: "fake-dev", version: "1.0.0" }));
    await writeFile(join(dir, "node_modules", "fake-dev", "index.js"), `export const dev = 1;\n`);
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("not-to-dev-dep");

    await manifest({ peerDependencies: { "fake-dev": "1.0.0" } });
    const peer = await depcruise(config, "src");
    expect(peer.exitCode).toBe(0);

    await manifest({});
    expect((await depcruise(config, "src")).exitCode).not.toBe(0);

    await writeFile(join(dir, "src/local.js"), `export const dev = 1;\n`);
    await writeFile(join(dir, "src/entry.js"), `import { dev } from "./local.js";\nexport const entry = dev;\n`);
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

async function writePackage(name: string, manifest: Record<string, unknown>, files: Record<string, string>): Promise<void> {
  const root = join(dir, "node_modules", name);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), content);
  }
}

test(
  "not-to-dev-dep goes red on a runtime dev import, green on a bare bun import that only @types/bun answers",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-bun-"));
    await writeProject({
      "src/entry.test.js": `import "./entry.js";\n`,
      "src/entry.js": `import { dev } from "fake-dev";\nexport const entry = dev;\n`,
    });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "checks-depcruiser-fixture",
        type: "module",
        devDependencies: { "@types/bun": "1.0.0", "fake-dev": "1.0.0" },
      }),
    );
    await writePackage("fake-dev", {}, { "index.js": `export const dev = 1;\n` });
    await writePackage("@types/bun", { types: "index.d.ts" }, { "index.d.ts": `declare module "bun" { export const $: unknown; }\n` });
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("not-to-dev-dep");

    await writeFile(join(dir, "src/entry.js"), `import { $ } from "bun";\nexport const entry = $;\n`);
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "not-to-unresolvable goes red on a missing package, green once it is installed",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-unresolvable-"));
    await writeProject({
      "src/entry.test.js": `import "./entry.js";\n`,
      "src/entry.js": `import { gone } from "missing-pkg";\nexport const entry = gone;\n`,
    });
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("not-to-unresolvable");
    expect(red.text).not.toContain("no-deep-imports");

    await writePackage("missing-pkg", {}, { "index.js": `export const gone = 1;\n` });
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "no-deep-imports goes red on a subpath the exports map omits, green on a published subpath and on bare entries",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-deep-"));
    await writeProject({
      "src/entry.test.js": `import "./entry.js";\n`,
      "src/entry.js": `import { deep } from "fake-pkg/lib/internal.js";\nexport const entry = deep;\n`,
    });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "checks-depcruiser-fixture",
        type: "module",
        dependencies: { "fake-pkg": "1.0.0", mainpkg: "1.0.0", "@scope/pkg": "1.0.0" },
      }),
    );
    await writePackage(
      "fake-pkg",
      { exports: { ".": "./index.js", "./published": "./lib/published.js" } },
      {
        "index.js": `export const top = 1;\n`,
        "lib/published.js": `export const published = 1;\n`,
        "lib/internal.js": `export const deep = 1;\n`,
      },
    );
    await writePackage("mainpkg", { main: "lib/main.js" }, { "lib/main.js": `export const m = 1;\n` });
    await writePackage(
      "@scope/pkg",
      { exports: { ".": "./dist/cli.mjs" } },
      { "dist/cli.mjs": `export const scoped = 1;\n`, "dist/private.mjs": `export const hidden = 1;\n` },
    );
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("no-deep-imports");
    expect(red.text).toContain("fake-pkg/lib/internal.js");

    await writeFile(join(dir, "src/entry.js"), `import { hidden } from "@scope/pkg/dist/private.mjs";\nexport const entry = hidden;\n`);
    const scopedRed = await depcruise(config, "src");
    expect(scopedRed.exitCode).not.toBe(0);
    expect(scopedRed.text).toContain("no-deep-imports");

    await writeFile(
      join(dir, "src/entry.js"),
      [
        `import { top } from "fake-pkg";`,
        `import { published } from "fake-pkg/published";`,
        `import { m } from "mainpkg";`,
        `import { scoped } from "@scope/pkg";`,
        `export const entry = top + published + m + scoped;`,
        ``,
      ].join("\n"),
    );
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a consumer layer rule rides along through extends, red then green",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-layers-"));
    await writeProject({
      "src/api.test.js": `import "./api/handler.js";\n`,
      "src/api/handler.js": `import "../ui/page.js";\nexport const handler = 1;\n`,
      "src/ui/page.js": `export const page = 1;\n`,
    });
    const config = await writeConfig([
      {
        name: "api-cannot-reach-ui",
        severity: "error",
        from: { path: "src/api" },
        to: { path: "src/ui" },
      },
    ]);

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("api-cannot-reach-ui");

    await writeFile(join(dir, "src/api/handler.js"), `export const handler = 1;\n`);
    await unlink(join(dir, "src/ui/page.js"));
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
