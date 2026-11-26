export type Shard = { readonly index: number; readonly count: number };

const SHARD = /^--shard=([1-9]\d*)\/([1-9]\d*)$/;

export function parseShard(arg: string): Shard | undefined {
  const match = SHARD.exec(arg);
  if (match === null) return undefined;
  const index = Number(match[1]);
  const count = Number(match[2]);
  return Number.isSafeInteger(index) && Number.isSafeInteger(count) && index <= count ? { index, count } : undefined;
}

export function shardFiles(files: readonly string[], timings: Readonly<Record<string, number>>, shard: Shard): readonly string[] {
  const recorded = files.flatMap((file) => timings[file] === undefined ? [] : [timings[file]]);
  const fallback = recorded.length === 0 ? 1 : recorded.reduce((sum, time) => sum + time, 0) / recorded.length || 1;
  const loads = Array.from({ length: Math.min(shard.count, files.length) }, () => ({ cost: 0, files: [] as string[] }));
  const ordered = files.map((file, order) => ({ file, order, cost: timings[file] ?? fallback }))
    .sort((a, b) => b.cost - a.cost || a.order - b.order);
  for (const item of ordered) {
    const lightest = loads.reduce((best, load) => load.cost < best.cost || (load.cost === best.cost && load.files.length < best.files.length) ? load : best);
    lightest.files.push(item.file);
    lightest.cost += item.cost;
  }
  return loads[shard.index - 1]?.files ?? [];
}
