import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const HOST_LOADED = "scripts/comment-matchers.ts";

const ENTRY = `import { SYNTAXES, refused } from "./comments";

const refusals = refused("src/probe.ts", "const a = 1; // @ts-expect-error\\n");
console.log(JSON.stringify({ reads: Object.hasOwn(SYNTAXES, "ts"), refusals }));
`;

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

test("the comment matchers run synchronously alone in a directory with no node_modules, as a host links them", async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-host-load-"));
  await copyFile(join(CHECKOUT, HOST_LOADED), join(dir, "comments.ts"));
  await writeFile(join(dir, "index.ts"), ENTRY);

  const ran = await $`${process.execPath} --no-install index.ts`.cwd(dir).nothrow().quiet();

  expect(ran.stderr.toString()).toBe("");
  expect(JSON.parse(ran.stdout.toString())).toEqual({
    reads: true,
    refusals: [
      "src/probe.ts:1 carries the machine-read directive `@ts-expect-error`. Fix what the tool is reporting, or stop running the tool on this file",
    ],
  });
  expect(ran.exitCode).toBe(0);
});

test(
  "the repo cruise refuses the host-loaded comment matchers an import of effect",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-host-cruise-"));
    for (const config of [".dependency-cruiser.cjs", "dependency-cruiser.config.js", "quality.json"]) {
      await copyFile(join(CHECKOUT, config), join(dir, config));
    }
    for (const linked of ["node_modules", "dist"]) await symlink(join(CHECKOUT, linked), join(dir, linked));
    await mkdir(join(dir, "scripts"));
    const source = await readFile(join(CHECKOUT, HOST_LOADED), "utf8");
    const cruise = async (text: string): Promise<string> => {
      await writeFile(join(dir, HOST_LOADED), text);
      const cruised = await $`${join(dir, "node_modules", ".bin", "depcruise")} --config .dependency-cruiser.cjs scripts`
        .cwd(dir)
        .nothrow()
        .quiet();
      return cruised.stdout.toString();
    };

    expect(await cruise(source)).not.toContain("host-loaded-imports-nothing");
    expect(await cruise(`import { Effect } from "effect";\nexport const planted = Effect.void;\n${source}`)).toMatch(
      /error host-loaded-imports-nothing: scripts\/comment-matchers\.ts → \S*node_modules\/effect\//,
    );
  },
  60_000,
);
