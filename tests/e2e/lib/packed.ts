import { $ } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { CHECKOUT } from "./fixture-repo.ts";

const Packed = Schema.fromJsonString(Schema.Tuple([Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) })]));

export async function packedPaths(): Promise<ReadonlySet<string>> {
  const packed = await $`npm pack --dry-run --json --ignore-scripts`.cwd(CHECKOUT).quiet();
  const [{ files }] = Schema.decodeSync(Packed)(packed.stdout.toString());
  return new Set(files.map(({ path }) => path));
}

const Manifest = Schema.Struct({ devDependencies: Schema.Record(Schema.String, Schema.String) });

export async function browserConsumer(scratch: (prefix: string) => Promise<string>, name: string): Promise<string> {
  const packDir = await scratch(`checks-${name}-pack-`);
  const packed = await $`bun pm pack --destination ${packDir} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet();
  const manifest = Schema.decodeUnknownSync(Manifest)(JSON.parse(await readFile(join(CHECKOUT, "package.json"), "utf8")));
  const dir = await scratch(`checks-${name}-consumer-`);
  const dependencies = { "@avi2dg/checks": `file:${packed.stdout.toString().trim()}`, "playwright-core": manifest.devDependencies["playwright-core"] };
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: `${name}-consumer`, type: "module", dependencies }));
  await $`bun install --ignore-scripts`.cwd(dir).quiet();
  return dir;
}
