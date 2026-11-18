import { Effect, FileSystem, Path } from "effect";
import { ACTION_FILES, fullActions, SETUP_ACTION, type RepositoryFile } from "./full-set/actions.ts";
import type { CallerSet, HeldFile } from "./site-names.ts";
import { WORKFLOWS } from "./site-names.ts";
import { differenceLines, differencesOf, differentLines, type Difference, type Layout } from "./workflow-set.ts";

export const readActionFiles = Effect.fn("readActionFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const held = yield* Effect.forEach(ACTION_FILES, (file) =>
    Effect.gen(function* () {
      const full = path.join(root, file);
      return (yield* fs.exists(full)) ? [{ path: file, text: yield* fs.readFileString(full) }] : [];
    }),
  );
  return held.flat();
});

// A repository opts into the full set by holding the setup action, so a kit upgrade alone moves no repository.
export const layoutOf = Effect.fn("layoutOf")(function* (root: string, kit: boolean, chosen: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const holdsSetup = yield* fs.exists((yield* Path.Path).join(root, SETUP_ACTION));
  return chosen || holdsSetup ? ({ full: true, kit } satisfies Layout) : ({ full: false } satisfies Layout);
});

function actionDifferences(set: CallerSet, present: readonly RepositoryFile[]): readonly Difference[] {
  const required = fullActions(set);
  const held = new Map(present.map(({ path, text }) => [path, text]));
  return [
    ...required.flatMap(({ path, text }): readonly Difference[] => {
      const holds = held.get(path);
      if (holds === undefined) return [{ kind: "missing", name: path }];
      return holds === text ? [] : [{ kind: "differs", name: path, lines: differentLines(holds, text) }];
    }),
    ...present.filter(({ path }) => !required.some((file) => file.path === path)).map(({ path }): Difference => ({ kind: "extra", name: path })),
  ];
}

export type HeldDifferences = { readonly workflows: readonly Difference[]; readonly actions: readonly Difference[] };

export function heldDifferences(set: CallerSet, workflows: readonly Pick<HeldFile, "name" | "text">[], actions: readonly RepositoryFile[], layout: Layout): HeldDifferences {
  return { workflows: differencesOf(set, workflows, layout), actions: layout.full ? actionDifferences(set, actions) : [] };
}

export const countOf = ({ workflows, actions }: HeldDifferences): number => workflows.length + actions.length;

export function heldDifferenceLines({ workflows, actions }: HeldDifferences, layout: Layout): readonly string[] {
  const written = layout.full ? "file" : "caller";
  return [
    ...workflows.flatMap((difference) => differenceLines(`${WORKFLOWS}/${difference.name}`, difference, written)),
    ...actions.flatMap((difference) => differenceLines(difference.name, difference, "file")),
  ];
}
