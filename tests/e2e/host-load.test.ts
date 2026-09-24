import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOST_LOADED = resolve(import.meta.dir, "..", "..", "scripts", "comments.ts");

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
  await copyFile(HOST_LOADED, join(dir, "comments.ts"));
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
