import { Effect, Option, Schema } from "effect";
import { InputMissing, optionalInput, requiredInput } from "./inputs.ts";

export type PagesDeploy = {
  readonly wranglerVersion: string;
  readonly directory: string;
  readonly project: string;
  readonly branch: string;
  readonly commitHash: string;
  readonly commitMessage: string;
  readonly commitDirty: boolean;
};

export function deployArgs({ wranglerVersion, directory, project, branch, commitHash, commitMessage, commitDirty }: PagesDeploy): readonly string[] {
  return [
    `wrangler@${wranglerVersion}`,
    "pages",
    "deploy",
    directory,
    "--project-name",
    project,
    "--branch",
    branch,
    "--commit-hash",
    commitHash,
    ...(commitMessage === "" ? [] : ["--commit-message", `${commitMessage} ${commitHash.slice(0, 7)}`]),
    ...(commitDirty ? ["--commit-dirty=true"] : []),
  ];
}

const flagOf = Effect.fn("flagOf")(function* (action: string, input: string, variable: string) {
  const value = yield* optionalInput(variable);
  if (value === "true" || value === "false") return value === "true";
  return yield* new InputMissing({ message: `${action} needs the ${input} input to be true or false, not '${value}'` });
});

export const deployFromEnv = Effect.fn("deployFromEnv")(function* (action: string) {
  return {
    wranglerVersion: yield* requiredInput(action, "wrangler-version", "WRANGLER_VERSION"),
    directory: yield* requiredInput(action, "directory", "DIRECTORY"),
    project: yield* requiredInput(action, "project", "PROJECT"),
    branch: yield* requiredInput(action, "branch", "BRANCH"),
    commitHash: yield* requiredInput(action, "commit-hash", "COMMIT_HASH"),
    commitMessage: yield* optionalInput("COMMIT_MESSAGE"),
    commitDirty: yield* flagOf(action, "commit-dirty", "COMMIT_DIRTY"),
  } satisfies PagesDeploy;
});

const DeployDetail = Schema.Struct({ type: Schema.Literal("pages-deploy-detailed"), alias: Schema.optional(Schema.NullOr(Schema.String)) });

const decodeDetail = Schema.decodeUnknownOption(Schema.fromJsonString(DeployDetail));

export function deployedAlias(ndjson: string): string {
  const details = ndjson.split("\n").flatMap((line) => Option.toArray(decodeDetail(line)));
  return details.at(-1)?.alias ?? "";
}
