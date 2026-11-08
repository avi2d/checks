// GitHub Actions runs at most 256 jobs from one matrix.
export const MAX_SHARDS = 256;

export type Shard = { readonly files: readonly string[]; readonly mutants: number };

export type ReportedMutant = { readonly static?: boolean; readonly status?: string };

export function runnableMutants(mutants: readonly ReportedMutant[]): number {
  return mutants.filter((mutant) => mutant.static !== true && mutant.status !== "Ignored").length;
}

// A file the report lacks may be new since it ran, so it weighs what the average reported file does.
export function mutantWeights(files: readonly string[], reported: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const known = files.flatMap((file) => reported.get(file) ?? []);
  const unknown = known.length === 0 ? 1 : Math.max(1, Math.ceil(known.reduce((sum, count) => sum + count, 0) / known.length));
  return new Map(files.map((file) => [file, reported.get(file) ?? unknown]));
}

// Each file in turn, heaviest first, joins the lightest shard so far, the lowest numbered on a tie.
export function balancedShards(weights: ReadonlyMap<string, number>, count: number): readonly Shard[] {
  const shards = Array.from({ length: count }, () => ({ files: new Array<string>(), mutants: 0 }));
  const heaviestFirst = [...weights].toSorted(([file, weight], [other, otherWeight]) => otherWeight - weight || file.localeCompare(other));
  for (const [file, weight] of heaviestFirst) {
    const lightest = shards.reduce((least, shard) => (shard.mutants < least.mutants ? shard : least));
    lightest.files.push(file);
    lightest.mutants += weight;
  }
  return shards.filter((shard) => shard.files.length > 0).map((shard) => ({ files: shard.files.toSorted(), mutants: shard.mutants }));
}
