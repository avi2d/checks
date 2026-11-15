import { Effect, Schema } from "effect";
import { SHARED_REPOSITORY } from "./mutation-workflow.ts";
import { workflowJobs, type Workflow } from "./workflow-references.ts";

export type RepositoryKind = "code" | "site";

export const DEFAULT_TEST_RUN = "bunx checks-test --pr";

const SHARED_RUNNER = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";

export const SITE_BUILD = "site-dist";

export type TestJob = {
  readonly name: string;
  readonly run: string;
  readonly browsers: string;
  readonly readsBuild: boolean;
  readonly heavy: boolean;
  readonly runsOn: string;
};

export type CiJobs = { readonly changes: boolean; readonly tests: readonly TestJob[] };

const FIXED_JOBS = ["changes", "static", "site", "checks"] as const;

const UNIT: TestJob = { name: "unit", run: DEFAULT_TEST_RUN, browsers: "", readsBuild: false, heavy: false, runsOn: SHARED_RUNNER };

const BROWSER: TestJob = { name: "browser", run: "bunx checks-browser --pr", browsers: "webkit", readsBuild: true, heavy: true, runsOn: SHARED_RUNNER };

export const DEFAULT_CI_JOBS: Readonly<Record<RepositoryKind, CiJobs>> = {
  code: { changes: true, tests: [{ ...UNIT, name: "test" }] },
  site: { changes: true, tests: [UNIT, BROWSER] },
};

const PARTS = `${SHARED_REPOSITORY}/.github/workflows/`;

const PART_FILES = ["changes.yml", "static.yml", "test.yml", "site-preview.yml", "gate.yml"] as const;

type Part = (typeof PART_FILES)[number];

function partOf(uses: unknown): Part | undefined {
  if (typeof uses !== "string" || !uses.startsWith(PARTS)) return undefined;
  const [file] = uses.slice(PARTS.length).split("@");
  return PART_FILES.find((part) => part === file);
}

const TestInputs = Schema.Struct({
  run: Schema.optionalKey(Schema.String),
  browsers: Schema.optionalKey(Schema.String),
  artifact: Schema.optionalKey(Schema.String),
  heavy: Schema.optionalKey(Schema.Boolean),
  "runs-on": Schema.optionalKey(Schema.String),
});

const decodeTestInputs = Schema.decodeUnknownEffect(TestInputs);

const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

class CiJobsFault extends Schema.TaggedError<CiJobsFault>()("CiJobsFault", {
  message: Schema.String,
}) {}

const testJobOf = Effect.fn("testJobOf")(function* (kind: RepositoryKind, path: string, name: string, inputs: unknown) {
  if (!JOB_ID.test(name) || FIXED_JOBS.some((fixed) => fixed === name)) {
    return yield* new CiJobsFault({ message: `${path} calls test.yml from job ${name}, a name the composed ci.yml cannot give a test job, so rename it` });
  }
  const held = yield* decodeTestInputs(inputs ?? {}).pipe(
    Effect.mapError((issue) => new CiJobsFault({ message: `${path} job ${name} passes a test.yml input that does not parse: ${issue.message}` })),
  );
  return {
    name,
    run: held.run ?? DEFAULT_TEST_RUN,
    browsers: held.browsers ?? "",
    readsBuild: kind === "site" && held.artifact === SITE_BUILD,
    heavy: held.heavy ?? false,
    runsOn: held["runs-on"] ?? SHARED_RUNNER,
  } satisfies TestJob;
});

// A ci.yml that calls no part, such as the single-job caller, records no choice, so it gets the default jobs of its kind.
export const ciJobsOf = Effect.fn("ciJobsOf")(function* (kind: RepositoryKind, ci: Workflow | undefined) {
  if (ci === undefined) return DEFAULT_CI_JOBS[kind];
  const parts = workflowJobs(ci).flatMap(([name, job]) => {
    const part = partOf(job["uses"]);
    return part === undefined ? [] : [{ name, job, part }];
  });
  if (parts.length === 0) return DEFAULT_CI_JOBS[kind];
  const tests = yield* Effect.forEach(
    parts.filter(({ part }) => part === "test.yml"),
    ({ name, job }) => testJobOf(kind, ci.path, name, job["with"]),
  );
  return { changes: parts.some(({ part }) => part === "changes.yml"), tests } satisfies CiJobs;
});
