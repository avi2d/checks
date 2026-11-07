import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path/posix";
import { TEMPLATE_DIRECTORY } from "../../../src/docs/doc-templates.ts";
import { CHECKOUT } from "../lib/fixture-repo.ts";
import { packedPaths } from "../lib/packed.ts";

const shipped = packedPaths();

async function unshipped(directory: string): Promise<readonly string[]> {
  const paths = await shipped;
  return readdirSync(join(CHECKOUT, directory))
    .map((name) => `${directory}/${name}`)
    .filter((path) => !paths.has(path));
}

test("every doc template ships where a consuming repository copies it from, with none left out of the tarball", async () => {
  expect(await unshipped(TEMPLATE_DIRECTORY)).toEqual([]);
}, 30_000);

test("the Stryker preset ships with every compiled module under dist/mutation/, not just the preset file", async () => {
  expect(await shipped).toContain("stryker.preset.js");
  expect(await unshipped("dist/mutation")).toEqual([]);
}, 30_000);
