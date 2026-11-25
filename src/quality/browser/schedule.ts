import type { CheckName } from "./declaration.ts";

export type PlannedCheckName = CheckName | "targets" | "hook";

type PagePlan = { readonly mode: "shared"; readonly alone: false } | { readonly mode: "independent"; readonly alone: boolean };

export const PAGE_OF = {
  targets: { mode: "shared", alone: false },
  layout: { mode: "independent", alone: false },
  keyboard: { mode: "independent", alone: false },
  // Other page loads can delay the motion read until after the transition ends.
  motion: { mode: "independent", alone: true },
  axe: { mode: "shared", alone: false },
  nesting: { mode: "shared", alone: false },
  html: { mode: "independent", alone: false },
  links: { mode: "independent", alone: false },
  assets: { mode: "independent", alone: false },
  contrast: { mode: "independent", alone: false },
  weight: { mode: "independent", alone: false },
  shift: { mode: "independent", alone: false },
  look: { mode: "independent", alone: false },
  hook: { mode: "independent", alone: true },
} as const satisfies Record<PlannedCheckName, PagePlan>;

export function planCells<Check extends PagePlan & { readonly name: string }>(checks: readonly Check[]): {
  readonly shared: readonly Extract<Check, { readonly mode: "shared" }>[];
  readonly separate: readonly Exclude<Check, { readonly mode: "shared" }>[];
} {
  const readers = checks.filter((check): check is Extract<Check, { readonly mode: "shared" }> => check.mode === "shared");
  // Axe injects scripts, so the other readers need the page before the audit.
  const shared = readers.toSorted((a, b) => Number(a.name === "axe") - Number(b.name === "axe"));
  const separate = checks.filter((check): check is Exclude<Check, { readonly mode: "shared" }> => check.mode !== "shared");
  return { shared, separate };
}

export type ReportPlace = {
  readonly visitIndex: number;
  readonly checkIndex: number;
};

export function compareReport(a: ReportPlace, b: ReportPlace): number {
  return a.visitIndex - b.visitIndex || a.checkIndex - b.checkIndex;
}
