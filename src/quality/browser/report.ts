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
  readonly undeclaredPages: readonly string[];
};

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
    ...(outcome.undeclaredPages.length === 0
      ? []
      : [`${NAME}: advisory, ${outcome.undeclaredPages.length} built page(s) no route declares: ${outcome.undeclaredPages.join(", ")}`]),
    ...(unverified.length === 0 ? [] : [`${NAME}: ${unverified.length} contrast check(s) axe cannot measure, reported as unverified:`, ...unverified.map((one) => `  ${one}`)]),
    ...(failures.length === 0 ? [`${NAME}: ${scope} pass`] : [`${NAME}: ${failures.length} failure(s) in ${scope}:`, ...failures.map((one) => `  ${one}`)]),
  ].join("\n");
}
