import { Effect, FileSystem, Path, Schema } from "effect";
import { KIT_PACKAGE_NAME } from "../core/test-script.ts";
import { decodeSetting, loadSettings, ReleaseAssets, RepositoryVisibility, SETTINGS_FILE } from "../core/settings.ts";
import { callerOptionsOf, RELEASE_ASSETS_SCRIPT, type CallerOptions } from "./caller-options.ts";
import { ciJobsOf, type CiJobs } from "./ci-jobs.ts";
import { WorkspacePatterns, publicWorkspacesOf } from "./workspace-packages.ts";
import { readTestScriptContext } from "./test-scripts.ts";
import type { TestTier } from "../core/test-script.ts";
import { calledFileOf, isRecord, workflowJobs, type Workflow } from "./workflow-references.ts";

export const WORKFLOWS = ".github/workflows";

export const SITE_NAME_KEYS = ["pages", "domain", "production"] as const;

type SiteNameKey = (typeof SITE_NAME_KEYS)[number];

export const SITE_NAME_VARIABLES = { pages: "SITE_PAGES", domain: "SITE_DOMAIN", production: "SITE_PRODUCTION" } as const satisfies Readonly<Record<SiteNameKey, string>>;

const PLACEHOLDERS = { pages: "<project>", domain: "<domain>", production: "<owner/name>" } as const satisfies Readonly<Record<SiteNameKey, string>>;

const ProjectName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/, { message: "is not a Cloudflare Pages project name, such as acme" }),
);
const Domain = Schema.String.check(Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, { message: "is not a domain, such as acme.example" }));
const Repository = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, { message: "is not a repository, such as acme/acme.example" }));

const SiteNames = Schema.Struct({ pages: ProjectName, domain: Domain, production: Repository });

export type SiteNames = typeof SiteNames.Type;

const decodeSiteNames = Schema.decodeUnknownEffect(SiteNames);

export type SiteNameFlags = Readonly<Partial<Record<SiteNameKey, string>>>;

export type CallerSet =
  | { readonly kind: "code"; readonly ci: CiJobs; readonly options: CallerOptions }
  | { readonly kind: "site"; readonly names: SiteNames; readonly ci: CiJobs; readonly options: CallerOptions };

class CallerSetFault extends Schema.TaggedError<CallerSetFault>()("CallerSetFault", {
  message: Schema.String,
}) {}

type HeldName = { readonly key: SiteNameKey; readonly value: string; readonly path: string };

const SITE_CALLERS = ["site-ci.yml", "site-main.yml", "site-production.yml", "site-preview.yml", "preview-remove.yml"] as const;

function calledSiteCaller(uses: unknown): string | undefined {
  const file = calledFileOf(uses);
  return file !== undefined && (SITE_CALLERS as readonly string[]).includes(file) ? file : undefined;
}

function writtenNames(workflow: Workflow): readonly HeldName[] {
  const env = isRecord(workflow.document) ? workflow.document["env"] : undefined;
  if (!isRecord(env)) return [];
  return SITE_NAME_KEYS.flatMap((key): readonly HeldName[] => {
    const value = env[SITE_NAME_VARIABLES[key]];
    return typeof value === "string" ? [{ key, value, path: workflow.path }] : [];
  });
}

function calledNames(workflow: Workflow): readonly HeldName[] {
  return workflowJobs(workflow)
    .filter(([, job]) => calledSiteCaller(job["uses"]) !== undefined)
    .flatMap(([, job]) => {
      const inputs = job["with"];
      if (!isRecord(inputs)) return [];
      return SITE_NAME_KEYS.flatMap((key): readonly HeldName[] => {
        const value = inputs[key];
        return typeof value === "string" ? [{ key, value, path: workflow.path }] : [];
      });
    });
}

function heldNames(workflow: Workflow): readonly HeldName[] {
  return [...writtenNames(workflow), ...calledNames(workflow)];
}

function holdsSiteWorkflow(workflows: readonly Workflow[]): boolean {
  return workflows.some((workflow) => writtenNames(workflow).length > 0 || workflowJobs(workflow).some(([, job]) => calledSiteCaller(job["uses"]) !== undefined));
}

function conflictOf(held: readonly HeldName[]): string | undefined {
  for (const key of SITE_NAME_KEYS) {
    const named = held.filter((name) => name.key === key);
    const [first] = named;
    const other = named.find((name) => name.value !== first?.value);
    if (first !== undefined && other !== undefined) {
      return `${first.path} passes ${key} ${first.value} and ${other.path} passes ${key} ${other.value}, so make the site workflows agree`;
    }
  }
  return undefined;
}

export function flagMismatchOf(workflows: readonly Workflow[], flags: SiteNameFlags): string | undefined {
  const held = workflows.flatMap(heldNames);
  for (const key of SITE_NAME_KEYS) {
    const flag = flags[key];
    if (flag === undefined) continue;
    const other = held.find((name) => name.key === key && name.value !== flag);
    if (other !== undefined) return `${other.path} passes ${key} ${other.value} and --${key} passes ${flag}, so rename with checks-workflows --write`;
  }
  return undefined;
}

function listed(keys: readonly SiteNameKey[]): string {
  return keys.length > 1 ? `${keys.slice(0, -1).join(", ")} and ${keys.at(-1) ?? ""}` : keys.join("");
}

function flagsOf(keys: readonly SiteNameKey[]): string {
  return keys.map((key) => `--${key} ${PLACEHOLDERS[key]}`).join(" ");
}

const heldWorkflow = (workflows: readonly Workflow[]) => (name: string) => workflows.find(({ path }) => path === `${WORKFLOWS}/${name}`);

type UncarriedInput = { readonly path: string; readonly name: string; readonly file: string; readonly input: string };

function uncarriedInputs(workflows: readonly Workflow[]): readonly UncarriedInput[] {
  return workflows.flatMap((workflow) =>
    workflowJobs(workflow).flatMap(([name, job]) => {
      const file = calledSiteCaller(job["uses"]);
      if (file === undefined) return [];
      const inputs = job["with"];
      if (!isRecord(inputs)) return [];
      return Object.keys(inputs)
        .filter((input) => !SITE_NAME_KEYS.some((key) => key === input))
        .map((input) => ({ path: workflow.path, name, file, input }));
    })
  );
}

const heldCiJobs = (kind: CallerSet["kind"], workflows: readonly Workflow[], publicRepository: boolean, docsBuild: boolean, testTiers: CallerInputs["testTiers"] | undefined) =>
  ciJobsOf(kind, heldWorkflow(workflows)("ci.yml"), { publicRepository, docsBuild, testTiers }).pipe(Effect.mapError((fault) => new CallerSetFault({ message: fault.message })));

function releaseAssetsFault(site: boolean, publicRepository: boolean): string | undefined {
  if (site) return `${SETTINGS_FILE} sets releaseAssets, but a site's main.yml holds no release job to attach the assets to, so remove it`;
  if (!publicRepository) return `${SETTINGS_FILE} sets releaseAssets in a private repository, where checks-ci-wiring refuses the macOS runner the assets job needs, so remove it`;
  return undefined;
}

export const callerSetOf = Effect.fn("callerSetOf")(function* (workflows: readonly Workflow[], flags: SiteNameFlags, rerun: string, publishes: boolean, publishWorkspaces: boolean, needsReleaseChecks: boolean, publicRepository: boolean, docsBuild?: boolean, testTiers?: CallerInputs["testTiers"], releaseAssets?: boolean) {
  const buildDocs = docsBuild === true;
  const attachAssets = releaseAssets === true;
  const flagged = SITE_NAME_KEYS.some((key) => flags[key] !== undefined);
  const options = callerOptionsOf(heldWorkflow(workflows), publishes, publishWorkspaces, needsReleaseChecks, publicRepository, buildDocs, attachAssets);
  const [extra] = uncarriedInputs(workflows);
  if (extra !== undefined) {
    return yield* new CallerSetFault({
      message: `${extra.path} job ${extra.name} passes ${extra.input} to ${extra.file}, an input the written set cannot carry, so remove it by hand`,
    });
  }
  const site = holdsSiteWorkflow(workflows) || flagged;
  const assetsFault = attachAssets ? releaseAssetsFault(site, publicRepository) : undefined;
  if (assetsFault !== undefined) return yield* new CallerSetFault({ message: assetsFault });
  if (!site) return { kind: "code", ci: yield* heldCiJobs("code", workflows, publicRepository, buildDocs, testTiers), options } satisfies CallerSet;
  const held = workflows.flatMap(heldNames).filter(({ key }) => flags[key] === undefined);
  const conflict = conflictOf(held);
  if (conflict !== undefined) return yield* new CallerSetFault({ message: conflict });
  const named: Partial<Record<SiteNameKey, string>> = { ...Object.fromEntries(held.map(({ key, value }) => [key, value])), ...flags };
  const missing = SITE_NAME_KEYS.filter((key) => named[key] === undefined);
  if (missing.length > 0) {
    return yield* new CallerSetFault({ message: `the site workflows name no ${listed(missing)}, so run ${rerun} ${flagsOf(missing)}` });
  }
  const names = yield* decodeSiteNames(named).pipe(Effect.mapError((issue) => new CallerSetFault({ message: `a site name ${issue.message}` })));
  return { kind: "site", names, ci: yield* heldCiJobs("site", workflows, publicRepository, buildDocs, testTiers), options } satisfies CallerSet;
});

const FLAGS = new Map(SITE_NAME_KEYS.map((key) => [`--${key}`, key]));

export type ParsedFlags = { readonly flags: SiteNameFlags; readonly rest: readonly string[] };

export function parseSiteNameFlags(args: readonly string[]): ParsedFlags | undefined {
  const flags: Partial<Record<SiteNameKey, string>> = {};
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const key = FLAGS.get(arg);
    if (key === undefined) {
      rest.push(arg);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--") || flags[key] !== undefined) return undefined;
    flags[key] = value;
    index += 1;
  }
  return { flags, rest };
}

export type HeldFile = { readonly name: string; readonly text: string; readonly workflow: Workflow };

// A file that does not parse names no site, and the comparison still names it.
const parsedOrNothing = (text: string): Effect.Effect<unknown> => Effect.try(() => Bun.YAML.parse(text)).pipe(Effect.orElseSucceed(() => undefined));

const decodePackage = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  private: Schema.optionalKey(Schema.Boolean),
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  workspaces: Schema.optionalKey(WorkspacePatterns),
})));

const readPackage = Effect.fn("readPackage")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, "package.json");
  if (!(yield* fs.exists(file))) return undefined;
  return yield* fs.readFileString(file).pipe(
    Effect.flatMap(decodePackage),
    Effect.mapError((cause) => new CallerSetFault({ message: `cannot read package.json: ${cause.message}` })),
  );
});

export type CallerInputs = { readonly publishes: boolean; readonly publishWorkspaces: boolean; readonly needsReleaseChecks: boolean; readonly kit: boolean; readonly publicRepository: boolean; readonly docsBuild: boolean; readonly testTiers: ReadonlySet<TestTier>; readonly releaseAssets: boolean };

export type CallerInputOverrides = { readonly private?: boolean; readonly hasTestScript?: boolean };

export const callerInputsOf = Effect.fn("callerInputsOf")(function* (root: string, overrides?: CallerInputOverrides) {
  const held = yield* readPackage(root);
  const settings = yield* loadSettings(root);
  const configuredVisibility = settings["repositoryVisibility"];
  const visibility = configuredVisibility === undefined ? "public" : yield* decodeSetting("repositoryVisibility", RepositoryVisibility, configuredVisibility);
  const configuredAssets = settings["releaseAssets"];
  const releaseAssets = configuredAssets === undefined ? false : yield* decodeSetting("releaseAssets", ReleaseAssets, configuredAssets);
  if (releaseAssets && held?.scripts?.[RELEASE_ASSETS_SCRIPT] === undefined) {
    return yield* new CallerSetFault({ message: `${SETTINGS_FILE} sets releaseAssets, but package.json defines no ${RELEASE_ASSETS_SCRIPT} script to build the assets, so add the script or remove the setting` });
  }
  const isPrivate = overrides?.private ?? held?.private === true;
  const needsReleaseChecks = overrides?.hasTestScript ?? held?.scripts?.["test"] !== undefined;
  const workspaces = yield* publicWorkspacesOf(root, { private: isPrivate, workspaces: held?.workspaces });
  const testTiers = (yield* readTestScriptContext(root, held?.name)).present;
  return { publishes: !isPrivate, publishWorkspaces: workspaces.length > 0, needsReleaseChecks, kit: held?.name === KIT_PACKAGE_NAME, publicRepository: visibility === "public", docsBuild: held?.scripts?.["docs:build"] !== undefined, testTiers, releaseAssets } satisfies CallerInputs;
});

export const readWorkflowFiles = Effect.fn("readWorkflowFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const directory = (yield* Path.Path).join(root, WORKFLOWS);
  if (!(yield* fs.exists(directory))) return [];
  const names = (yield* fs.readDirectory(directory)).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).sort();
  return yield* Effect.forEach(names, (name) =>
    Effect.gen(function* () {
      const text = yield* fs.readFileString(`${directory}/${name}`);
      return { name, text, workflow: { path: `${WORKFLOWS}/${name}`, document: yield* parsedOrNothing(text), text } } satisfies HeldFile;
    }),
  );
});

