import { parseShard, type Shard } from "../../core/shard.ts";

const PR = "--pr";
const SHARD = "--shard=";

export type BrowserArgs = { readonly pr: boolean; readonly directory: string; readonly shard: Shard | undefined };

export function browserArgs(args: readonly string[]): BrowserArgs | undefined {
  const pr = args.filter((arg) => arg === PR).length;
  const shards = args.filter((arg) => arg.startsWith(SHARD));
  const rest = args.filter((arg) => arg !== PR && !arg.startsWith(SHARD));
  if (pr > 1 || shards.length > 1 || rest.length > 1 || rest.some((arg) => arg.startsWith("--"))) return undefined;
  const shard = shards[0] === undefined ? undefined : parseShard(shards[0]);
  if (shards.length === 1 && shard === undefined) return undefined;
  return { pr: pr === 1, directory: rest[0] ?? ".", shard };
}
