import { Config, Console, Effect, Schema } from "effect";
import { ApiError, callApiFor, type Method } from "./api.ts";
import { InputMissing, optionalInput, requiredInput } from "./inputs.ts";

export type Account = { readonly apiBase: string; readonly accountId: string; readonly token: string };

const Stage = Schema.Struct({ name: Schema.String, status: Schema.String });

const Deployment = Schema.Struct({
  id: Schema.String,
  environment: Schema.optional(Schema.NullOr(Schema.String)),
  latest_stage: Schema.optional(Schema.NullOr(Stage)),
  deployment_trigger: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        metadata: Schema.optional(
          Schema.NullOr(Schema.Struct({ branch: Schema.optional(Schema.NullOr(Schema.String)), commit_hash: Schema.optional(Schema.NullOr(Schema.String)) })),
        ),
      }),
    ),
  ),
});

type Deployment = typeof Deployment.Type;

const Project = Schema.Struct({
  result: Schema.Struct({ subdomain: Schema.String, canonical_deployment: Schema.optional(Schema.NullOr(Deployment)) }),
});

const Deployments = Schema.Struct({
  result: Schema.Array(Deployment),
  result_info: Schema.optional(Schema.NullOr(Schema.Struct({ total_pages: Schema.optional(Schema.NullOr(Schema.Finite)) }))),
});

const Created = Schema.Struct({ result: Schema.Struct({ name: Schema.String }) });

const Deleted = Schema.Struct({ success: Schema.Boolean });

const PAGE_SIZE = 25;

export const accountFromEnv = Effect.fn("accountFromEnv")(function* (action: string) {
  const account = yield* Config.all({
    apiBase: Config.String("CLOUDFLARE_API_BASE").pipe(Config.withDefault("https://api.cloudflare.com/client/v4")),
    accountId: optionalInput("CLOUDFLARE_ACCOUNT_ID"),
    token: optionalInput("CLOUDFLARE_API_TOKEN"),
  });
  const empty = [account.token === "" ? "api-token" : "", account.accountId === "" ? "account-id" : ""].filter((input) => input !== "");
  if (empty.length > 0) {
    return yield* new InputMissing({ message: `${action} needs the api-token and account-id inputs, and ${empty.join(" and ")} is empty` });
  }
  return account satisfies Account;
});

export const branchTargetFromEnv = Effect.fn("branchTargetFromEnv")(function* (action: string) {
  return {
    account: yield* accountFromEnv(action),
    project: yield* requiredInput(action, "project", "PROJECT"),
    branch: yield* requiredInput(action, "branch", "BRANCH"),
  };
});

const cloudflare = <S extends Schema.Top & { readonly DecodingServices: never }>(account: Account, schema: S, method: Method, path: string, body?: unknown) =>
  callApiFor(schema, { base: `${account.apiBase}/accounts/${account.accountId}`, path, method, token: account.token, body });

const projectPath = (name: string) => `/pages/projects/${encodeURIComponent(name)}`;

const readProject = (account: Account, name: string) => cloudflare(account, Project, "GET", projectPath(name));

// Cloudflare suffixes the pages.dev host when another account holds the name, so the host is read, never assumed.
export const readProjectHost = Effect.fn("readProjectHost")(function* (account: Account, name: string) {
  const project = yield* readProject(account, name);
  return project.result.subdomain;
});

export const projectHost = Effect.fn("projectHost")(function* (account: Account, name: string) {
  return yield* readProjectHost(account, name).pipe(
    Effect.catchIf(
      (error) => error.status === 404,
      () =>
        cloudflare(account, Created, "POST", "/pages/projects", { name, production_branch: "main" }).pipe(
          Effect.tap(() => Console.error(`created the Cloudflare Pages project ${name}`)),
          Effect.flatMap(() => readProjectHost(account, name)),
        ),
    ),
  );
});

export function servedCommitOf(canonical: Deployment | null | undefined): string | undefined {
  if (canonical?.environment !== "production") return undefined;
  if (canonical.latest_stage?.name !== "deploy" || canonical.latest_stage.status !== "success") return undefined;
  const commit = canonical.deployment_trigger?.metadata?.commit_hash ?? "";
  return commit === "" ? undefined : commit;
}

export const servedCommit = Effect.fn("servedCommit")(function* (account: Account, name: string) {
  const project = yield* readProject(account, name);
  const commit = servedCommitOf(project.result.canonical_deployment);
  if (commit === undefined) return yield* new ApiError({ message: `the Pages project ${name} serves no deployment with a commit`, status: 200 });
  return commit;
});

const branchDeploymentIds = Effect.fn("branchDeploymentIds")(function* (account: Account, name: string, branch: string) {
  const ids: string[] = [];
  for (let page = 1, pages = 1; page <= pages; page += 1) {
    const listed = yield* cloudflare(account, Deployments, "GET", `${projectPath(name)}/deployments?env=preview&per_page=${PAGE_SIZE}&page=${page}`);
    pages = listed.result_info?.total_pages ?? 1;
    ids.push(...listed.result.filter((deployment) => deployment.deployment_trigger?.metadata?.branch === branch).map((deployment) => deployment.id));
  }
  return ids;
});

// Deleting while paging would shift later deployments onto pages already read, so every id is read first.
export const removeBranch = Effect.fn("removeBranch")(function* (account: Account, name: string, branch: string) {
  const ids = yield* branchDeploymentIds(account, name, branch);
  yield* Effect.forEach(ids, (id) => cloudflare(account, Deleted, "DELETE", `${projectPath(name)}/deployments/${encodeURIComponent(id)}?force=true`), {
    discard: true,
  });
  const left = yield* branchDeploymentIds(account, name, branch);
  if (left.length > 0) {
    return yield* new ApiError({ message: `the Cloudflare API still lists ${left.length} deployment(s) of ${branch} after the delete`, status: 200 });
  }
  return ids.length;
});
