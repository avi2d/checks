export type Shard = { readonly index: number; readonly count: number };

const SHARD = /^--shard=([1-9]\d*)\/([1-9]\d*)$/;

export function parseShard(arg: string): Shard | undefined {
  const match = SHARD.exec(arg);
  if (match === null) return undefined;
  const index = Number(match[1]);
  const count = Number(match[2]);
  return Number.isSafeInteger(index) && Number.isSafeInteger(count) && index <= count ? { index, count } : undefined;
}
