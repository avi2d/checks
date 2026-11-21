import { fullAdvisories, fullDocs, fullFlake, fullRequiredSet } from "./full-set.ts";
import { MUTATION_WORKFLOW } from "./full-set/mutation.ts";
import type { CallerSet } from "./site-names.ts";

// The kit publishes through the release.yml that npm's trusted publishing names, so it writes its release files by hand.
const KIT_OWN = ["release.yml", "release-pr.yml"];

export function isIgnoredWorkflow(name: string, kit: boolean): boolean {
  return name === "pr-text.yml" || (kit && KIT_OWN.includes(name));
}

export type WorkflowFile = { readonly name: string; readonly text: string };

export type Difference =
  | { readonly kind: "missing"; readonly name: string }
  | { readonly kind: "extra"; readonly name: string }
  | { readonly kind: "differs"; readonly name: string; readonly lines: readonly DifferentLine[] };

type DifferentLine = { readonly line: number; readonly holds: string | undefined; readonly writes: string | undefined };

const MUTATION: WorkflowFile = { name: "mutation.yml", text: MUTATION_WORKFLOW };

export function requiredSet(set: CallerSet, kit: boolean): readonly WorkflowFile[] {
  return fullRequiredSet(set, kit);
}

// An optional file may be absent, but a present one holds exactly this text.
export function byHandSet(set: CallerSet): readonly WorkflowFile[] {
  const { advisoriesCron, flake, pages } = set.options;
  const docs = pages === undefined ? [] : [fullDocs(pages, set.options.publicRepository)];
  const advisories = fullAdvisories(advisoriesCron, set.options.publicRepository);
  return set.kind === "site" ? [advisories, ...docs] : [advisories, MUTATION, fullFlake(flake, set.options.claudeVersion, set.options.publicRepository), ...docs];
}

export function differentLines(holds: string, writes: string): readonly DifferentLine[] {
  const held = holds.split("\n");
  const written = writes.split("\n");
  return Array.from({ length: Math.max(held.length, written.length) }, (_, index) => ({ line: index + 1, holds: held[index], writes: written[index] })).filter(
    ({ holds: one, writes: other }) => one !== other,
  );
}

export function differencesOf(set: CallerSet, present: readonly WorkflowFile[], kit: boolean): readonly Difference[] {
  const ignored = (name: string): boolean => isIgnoredWorkflow(name, kit);
  const held = new Map(present.filter(({ name }) => !ignored(name)).map(({ name, text }) => [name, text]));
  const required = requiredSet(set, kit);
  const byHand = byHandSet(set);
  const known = new Set([...required, ...byHand].map(({ name }) => name));
  const judged = [...required, ...byHand.filter(({ name }) => held.has(name))];
  return [
    ...judged.flatMap((file): readonly Difference[] => {
      const text = held.get(file.name);
      if (text === undefined) return [{ kind: "missing", name: file.name }];
      if (text === file.text) return [];
      return [{ kind: "differs", name: file.name, lines: differentLines(text, file.text) }];
    }),
    ...present.filter(({ name }) => !known.has(name) && !ignored(name)).map(({ name }): Difference => ({ kind: "extra", name })),
  ];
}

const shown = (text: string | undefined): string => (text === undefined ? "no line" : JSON.stringify(text));

export function differenceLines(path: string, difference: Difference): readonly string[] {
  if (difference.kind === "missing") return [`  ${path}: missing`];
  if (difference.kind === "extra") return [`  ${path}: no file of the set, so delete it`];
  return [
    `  ${path}: differs from the file checks-workflows writes`,
    ...difference.lines.map(({ line, holds, writes }) => `    line ${line}: holds ${shown(holds)}, checks-workflows writes ${shown(writes)}`),
  ];
}
