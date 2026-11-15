import { Effect, FileSystem, Path, Schema } from "effect";
import { SHARED_REPOSITORY } from "./mutation-workflow.ts";
import { isRecord, workflowJobs, type Workflow } from "./workflow-references.ts";

export const WORKFLOWS = ".github/workflows";

export const SITE_NAME_KEYS = ["pages", "domain", "production"] as const;

type SiteNameKey = (typeof SITE_NAME_KEYS)[number];

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

export type CallerSet = { readonly kind: "code" } | { readonly kind: "site"; readonly names: SiteNames };

class SiteNamesFault extends Schema.TaggedError<SiteNamesFault>()("SiteNamesFault", {
  message: Schema.String,
}) {}

const NAMED_SITE_WORKFLOWS = ["site-ci.yml", "site-main.yml", "site-production.yml", "preview-remove.yml"] as const;

const SHARED_WORKFLOWS = `${SHARED_REPOSITORY}/.github/workflows/`;

export function takesSiteNames(shared: string): boolean {
  const [file] = shared.split("@");
  return NAMED_SITE_WORKFLOWS.some((name) => name === file);
}

function calledSiteWorkflow(uses: unknown): boolean {
  return typeof uses === "string" && uses.startsWith(SHARED_WORKFLOWS) && takesSiteNames(uses.slice(SHARED_WORKFLOWS.length));
}

type HeldName = { readonly key: SiteNameKey; readonly value: string; readonly path: string };

function heldNames(workflow: Workflow): readonly HeldName[] {
  return workflowJobs(workflow)
    .filter(([, job]) => calledSiteWorkflow(job["uses"]))
    .flatMap(([, job]) => {
      const inputs = job["with"];
      if (!isRecord(inputs)) return [];
      return SITE_NAME_KEYS.flatMap((key): readonly HeldName[] => {
        const value = inputs[key];
        return typeof value === "string" ? [{ key, value, path: workflow.path }] : [];
      });
    });
}

function callsSiteWorkflow(workflows: readonly Workflow[]): boolean {
  return workflows.some((workflow) => workflowJobs(workflow).some(([, job]) => calledSiteWorkflow(job["uses"])));
}

function conflictOf(held: readonly HeldName[]): string | undefined {
  for (const key of SITE_NAME_KEYS) {
    const named = held.filter((name) => name.key === key);
    const [first] = named;
    const other = named.find((name) => name.value !== first?.value);
    if (first !== undefined && other !== undefined) {
      return `${first.path} passes ${key} ${first.value} and ${other.path} passes ${key} ${other.value}, so make the site callers agree`;
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

export const callerSetOf = Effect.fn("callerSetOf")(function* (workflows: readonly Workflow[], flags: SiteNameFlags, rerun: string) {
  const flagged = SITE_NAME_KEYS.some((key) => flags[key] !== undefined);
  if (!callsSiteWorkflow(workflows) && !flagged) return { kind: "code" } satisfies CallerSet;
  const held = workflows.flatMap(heldNames).filter(({ key }) => flags[key] === undefined);
  const conflict = conflictOf(held);
  if (conflict !== undefined) return yield* new SiteNamesFault({ message: conflict });
  const named: Partial<Record<SiteNameKey, string>> = { ...Object.fromEntries(held.map(({ key, value }) => [key, value])), ...flags };
  const missing = SITE_NAME_KEYS.filter((key) => named[key] === undefined);
  if (missing.length > 0) {
    return yield* new SiteNamesFault({ message: `the site callers pass no ${listed(missing)}, so run ${rerun} ${flagsOf(missing)}` });
  }
  const names = yield* decodeSiteNames(named).pipe(Effect.mapError((issue) => new SiteNamesFault({ message: `a site name ${issue.message}` })));
  return { kind: "site", names } satisfies CallerSet;
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

// A file that does not parse calls no shared workflow, and the comparison still names it.
const parsedOrNothing = (text: string): Effect.Effect<unknown> => Effect.try(() => Bun.YAML.parse(text)).pipe(Effect.orElseSucceed(() => undefined));

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

