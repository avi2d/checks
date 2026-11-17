import { Config, Effect, Schema } from "effect";
import { callApi, callApiFor, type ApiError, type Method } from "./api.ts";
import { requiredInput } from "./inputs.ts";

export type Repository = { readonly apiBase: string; readonly name: string; readonly token: string };

export const repositoryFromEnv = Effect.fn("repositoryFromEnv")(function* (action: string) {
  return {
    apiBase: yield* Config.String("GITHUB_API_URL").pipe(Config.withDefault("https://api.github.com")),
    name: yield* Config.String("GITHUB_REPOSITORY"),
    token: yield* requiredInput(action, "token", "GH_TOKEN"),
  } satisfies Repository;
});

const baseOf = (repository: Repository) => `${repository.apiBase}/repos/${repository.name}`;

export const github = <S extends Schema.Top & { readonly DecodingServices: never }>(
  repository: Repository,
  schema: S,
  method: Method,
  path: string,
  body?: unknown,
): Effect.Effect<S["Type"], ApiError> => callApiFor(schema, { base: baseOf(repository), path, method, token: repository.token, body });

export const githubDelete = (repository: Repository, path: string): Effect.Effect<void, ApiError> =>
  callApi({ base: baseOf(repository), path, method: "DELETE", token: repository.token, body: undefined }).pipe(Effect.asVoid);
