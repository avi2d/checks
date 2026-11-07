import { $ } from "bun";
import { Schema } from "effect";
import { CHECKOUT } from "./fixture-repo.ts";

const Packed = Schema.fromJsonString(Schema.Tuple([Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) })]));

export async function packedPaths(): Promise<ReadonlySet<string>> {
  const packed = await $`npm pack --dry-run --json --ignore-scripts`.cwd(CHECKOUT).quiet();
  const [{ files }] = Schema.decodeSync(Packed)(packed.stdout.toString());
  return new Set(files.map(({ path }) => path));
}
