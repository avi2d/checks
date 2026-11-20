import type { CheckName } from "./declaration.ts";

export type PlannedCheckName = CheckName | "targets" | "hook";

export type PagePlan = {
  readonly sharing: "shared" | "separate";
  readonly alone: boolean;
};

export const PAGE_OF: Readonly<Record<PlannedCheckName, PagePlan>> = {
  targets: { sharing: "shared", alone: false },
  layout: { sharing: "separate", alone: false },
  keyboard: { sharing: "separate", alone: false },
  // Other page loads can delay the motion read until after the transition ends.
  motion: { sharing: "separate", alone: true },
  axe: { sharing: "separate", alone: false },
  nesting: { sharing: "shared", alone: false },
  html: { sharing: "separate", alone: false },
  links: { sharing: "separate", alone: false },
  assets: { sharing: "separate", alone: false },
  contrast: { sharing: "separate", alone: false },
  weight: { sharing: "separate", alone: false },
  shift: { sharing: "separate", alone: false },
  look: { sharing: "separate", alone: false },
  hook: { sharing: "separate", alone: true },
};

export type PlannedSharing = {
  readonly mode: "shared" | "independent";
  readonly alone: boolean;
};

export function planCells<Check extends PlannedSharing>(checks: readonly Check[]): {
  readonly shared: readonly Extract<Check, { readonly mode: "shared" }>[];
  readonly separate: readonly Exclude<Check, { readonly mode: "shared" }>[];
} {
  const shared = checks.filter((check): check is Extract<Check, { readonly mode: "shared" }> => check.mode === "shared");
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
