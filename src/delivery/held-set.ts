import { Effect, FileSystem, Path } from "effect";
import { ACTION_FILES, fullActions, type RepositoryFile } from "./full-set/actions.ts";
import type { CallerSet, HeldFile } from "./site-names.ts";
import { WORKFLOWS } from "./site-names.ts";
import { differenceLines, differencesOf, differentLines, type Difference } from "./workflow-set.ts";

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

export function heldDifferences(set: CallerSet, workflows: readonly Pick<HeldFile, "name" | "text">[], actions: readonly RepositoryFile[], kit: boolean): HeldDifferences {
  return { workflows: differencesOf(set, workflows, kit), actions: actionDifferences(set, actions) };
}

export const countOf = ({ workflows, actions }: HeldDifferences): number => workflows.length + actions.length;

export function heldDifferenceLines({ workflows, actions }: HeldDifferences): readonly string[] {
  return [
    ...workflows.flatMap((difference) => differenceLines(`${WORKFLOWS}/${difference.name}`, difference)),
    ...actions.flatMap((difference) => differenceLines(difference.name, difference)),
  ];
}
