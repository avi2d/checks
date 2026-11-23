import { describeVisit, type Declaration, type Visit } from "./declaration.ts";

export const NAME = "browser";

export type Run = {
  readonly check: string;
  readonly visit: Visit;
  readonly inventory: readonly string[];
  readonly found: readonly string[];
  readonly unverified: readonly string[];
};

export type Outcome = {
  readonly runs: readonly Run[];
  readonly missingRoutes: readonly string[];
};

export type Timing = {
  readonly path: string;
  readonly check: string;
  readonly start: number;
  readonly end: number;
};

function checkTimes(timings: readonly Timing[]): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const pages = new Map<string, Map<string, number>>();
  for (const { path, check, start, end } of timings) {
    const checks = pages.get(path) ?? new Map<string, number>();
    checks.set(check, (checks.get(check) ?? 0) + end - start);
    pages.set(path, checks);
  }
  return pages;
}

export function formatTimings(timings: readonly Timing[]): string {
  return [...checkTimes(timings)].map(([path, checks]) => {
    const total = [...checks.values()].reduce((sum, ms) => sum + ms, 0);
    return `${NAME}: timing ${path}: ${[...checks].map(([check, ms]) => `${check} ${Math.round(ms)}ms`).join(", ")}; check sum ${Math.round(total)}ms`;
  }).join("\n");
}

export function timingsSetting(timings: readonly Timing[]): string {
  const record = Object.fromEntries([...checkTimes(timings)].map(([path, checks]) =>
    [path, Object.fromEntries([...checks].map(([check, ms]) => [check, Math.round(ms)]))]));
  return `${NAME}: browserTimings ${JSON.stringify(record)}`;
}

export function counted(names: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => `${name} ${count}`);
}

function failuresOf({ runs, missingRoutes }: Outcome): readonly string[] {
  return [
    ...missingRoutes.map((path) => `route ${path} serves no page from the declared site`),
    ...(runs.length === 0 ? ["the declaration leaves no check to run"] : []),
    ...runs.flatMap(({ check, visit, found }) => found.map((one) => `${check} at ${describeVisit(visit)}: ${one}`)),
  ];
}

export function passes(outcome: Outcome): boolean {
  return failuresOf(outcome).length === 0;
}

export function report(declaration: Declaration, outcome: Outcome): string {
  const failures = failuresOf(outcome);
  const unverified = outcome.runs.flatMap(({ check, visit, unverified: some }) => some.map((one) => `${check} at ${describeVisit(visit)}: ${one}`));
  const scope = [
    `${outcome.runs.length} check run(s) over ${declaration.routes.length} route(s), ${declaration.viewports.length} viewport(s),`,
    `${declaration.states.length} state(s) and ${declaration.targets.length} target(s)`,
  ].join(" ");
  return [
    ...outcome.runs.map(({ check, visit, inventory }) => `${NAME}: ${check} at ${describeVisit(visit)} scanned ${inventory.length === 0 ? "nothing" : inventory.join(", ")}`),
    ...(unverified.length === 0 ? [] : [`${NAME}: ${unverified.length} contrast check(s) axe cannot measure, reported as unverified:`, ...unverified.map((one) => `  ${one}`)]),
    ...(failures.length === 0 ? [`${NAME}: ${scope} pass`] : [`${NAME}: ${failures.length} failure(s) in ${scope}:`, ...failures.map((one) => `  ${one}`)]),
  ].join("\n");
}
