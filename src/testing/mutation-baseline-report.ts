import { Option } from "effect";
import { LATEST_ARTIFACT } from "./mutation-baseline-saved.ts";

export type Kept = { readonly run: number; readonly id: number; readonly name: string };

export type Missed = { readonly id: number; readonly name: string; readonly error: string };

// A workflow command ends at a newline, so the error's own newlines and percent signs are escaped.
const annotated = (text: string): string => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

export function pruneReport(dryRun: boolean, removed: readonly number[], missed: readonly Missed[], keeping: readonly Kept[], saved: Option.Option<number>): string {
  const holdings = [
    ...keeping.map((keep) => `${keep.name} artifact ${keep.id} from run ${keep.run}`),
    ...Option.toArray(saved).map((run) => `the ${LATEST_ARTIFACT} run ${run} saved on the runner's disk`),
  ];
  const kept = holdings.length === 0 ? "no baseline artifacts" : holdings.join(", ");
  const deleted = removed.length === 0 ? "nothing to delete" : `deleted artifacts ${removed.join(", ")}`;
  if (dryRun) return `mutation-baseline: dry run, ${removed.length === 0 ? "nothing to delete" : `would delete artifacts ${removed.join(", ")}`}; would keep ${kept}`;
  if (missed.length === 0) return `mutation-baseline: ${deleted}; kept ${kept}`;
  const warnings = missed.map((miss) => `::warning::mutation-baseline: could not delete ${miss.name} artifact ${miss.id}: ${annotated(miss.error)}`);
  return [...warnings, `mutation-baseline: ${deleted}; kept ${kept}; could not delete artifacts ${missed.map((miss) => miss.id).join(", ")}`].join("\n");
}

export function pruned(entries: readonly string[], kept: number, restoring: string): readonly string[] {
  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .sort((one, other) => Number(other) - Number(one))
    .slice(kept)
    .filter((entry) => entry !== restoring);
}
