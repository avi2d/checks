import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..");
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
      "src/entry.test.js": `import "./entry.js";\n`,
      "src/entry.js": `import "./helper.js";\nexport const entry = 1;\n`,
      "src/helper.js": `import "./entry.js";\nexport const helper = 1;\n`,
    });
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("no-circular");

    await writeFile(join(dir, "src/helper.js"), `export const helper = 1;\n`);
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
  "not-to-dev-dep goes red on a runtime dev import, green once it is local",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-depcruiser-devdep-"));
    await writeProject({
      "src/entry.test.js": `import "./entry.js";\n`,
      "src/entry.js": `import { dev } from "fake-dev";\nexport const entry = dev;\n`,
    });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "checks-depcruiser-fixture",
        type: "module",
        devDependencies: { "fake-dev": "1.0.0" },
      }),
    );
    await mkdir(join(dir, "node_modules", "fake-dev"), { recursive: true });
    await writeFile(join(dir, "node_modules", "fake-dev", "package.json"), JSON.stringify({ name: "fake-dev", version: "1.0.0" }));
    await writeFile(join(dir, "node_modules", "fake-dev", "index.js"), `export const dev = 1;\n`);
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("not-to-dev-dep");

    await writeFile(join(dir, "src/local.js"), `export const dev = 1;\n`);
    await writeFile(join(dir, "src/entry.js"), `import { dev } from "./local.js";\nexport const entry = dev;\n`);
    const green = await depcruise(config, "src");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "no-deep-imports goes red on a subpath past the entry, green on the bare entry",
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
        dependencies: { "fake-pkg": "1.0.0" },
      }),
    );
    await mkdir(join(dir, "node_modules", "fake-pkg", "lib"), { recursive: true });
    await writeFile(join(dir, "node_modules", "fake-pkg", "package.json"), JSON.stringify({ name: "fake-pkg", version: "1.0.0" }));
    await writeFile(join(dir, "node_modules", "fake-pkg", "index.js"), `export const top = 1;\n`);
    await writeFile(join(dir, "node_modules", "fake-pkg", "lib", "internal.js"), `export const deep = 1;\n`);
    const config = await writeConfig();

    const red = await depcruise(config, "src");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("no-deep-imports");

    await writeFile(join(dir, "src/entry.js"), `import { top } from "fake-pkg";\nexport const entry = top;\n`);
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
