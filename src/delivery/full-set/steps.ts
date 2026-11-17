import { type SiteNames, SITE_NAME_VARIABLES } from "../site-names.ts";

export const CHECKOUT = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0";
export const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
export const CACHE = "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";
export const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0";
export const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
export const DOWNLOAD = "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2";
export const WRANGLER_VERSION = "4.156.1";

export type Pair = readonly [key: string, value: string];

export type StepHead = {
  readonly note?: string;
  readonly if?: string;
  readonly id?: string;
  readonly name?: string;
  readonly continueOnError?: true;
};

export type Step = StepHead & ({ readonly uses: string; readonly with?: readonly Pair[] } | { readonly run: string; readonly env?: readonly Pair[]; readonly shell?: "bash" });

export type Job = {
  readonly id: string;
  readonly needs?: string;
  readonly if?: string;
  readonly runsOn: string;
  readonly timeout: number;
  readonly concurrency?: string;
  readonly permissions: readonly string[];
  readonly env?: readonly Pair[];
  readonly outputs?: readonly Pair[];
  readonly steps: readonly Step[];
};

export type Workflow = {
  readonly name: string;
  readonly on: readonly string[];
  readonly concurrency?: string;
  readonly env?: readonly Pair[];
  readonly jobs: readonly Job[];
};

export const expression = (text: string): string => "${{ " + text + " }}";

// A value a person chose can hold a colon or a hash that YAML would read as structure.
export function scalar(value: string): string {
  const parsed: unknown = Bun.YAML.parse("value: " + value);
  return typeof parsed === "object" && parsed !== null && "value" in parsed && parsed.value === value ? value : JSON.stringify(value);
}

const pairLines = (indent: string, pairs: readonly Pair[]): readonly string[] => pairs.map(([key, value]) => indent + key + ": " + value);

const block = (indent: string, key: string, pairs: readonly Pair[] | undefined): readonly string[] =>
  pairs === undefined || pairs.length === 0 ? [] : [indent + key + ":", ...pairLines(indent + "  ", pairs)];

export function stepLines(step: Step, indent: string): readonly string[] {
  const head: Pair[] = [];
  if (step.if !== undefined) head.push(["if", step.if]);
  if (step.id !== undefined) head.push(["id", step.id]);
  if (step.name !== undefined) head.push(["name", step.name]);
  if (step.continueOnError === true) head.push(["continue-on-error", "true"]);
  const body: string[] = [];
  if ("uses" in step) {
    head.push(["uses", step.uses]);
    body.push(...block(indent + "  ", "with", step.with));
  } else {
    if (step.shell !== undefined) head.push(["shell", step.shell]);
    body.push(...block(indent + "  ", "env", step.env), indent + "  run: " + step.run);
  }
  const [first = "", ...rest] = [...pairLines(indent + "  ", head), ...body];
  return [...(step.note === undefined ? [] : [indent + "# " + step.note]), indent + "- " + first.trimStart(), ...rest];
}

function jobLines(job: Job): readonly string[] {
  const lines = ["  " + job.id + ":"];
  if (job.needs !== undefined) lines.push("    needs: " + job.needs);
  if (job.if !== undefined) lines.push("    if: " + job.if);
  lines.push("    runs-on: " + job.runsOn, "    timeout-minutes: " + String(job.timeout));
  if (job.concurrency !== undefined) lines.push("    concurrency:", "      group: " + job.concurrency, "      cancel-in-progress: false");
  lines.push("    permissions:", ...job.permissions.map((permission) => "      " + permission));
  lines.push(...block("    ", "env", job.env), ...block("    ", "outputs", job.outputs));
  return [...lines, "    steps:", ...job.steps.flatMap((step) => stepLines(step, "      "))];
}

export function workflowText(workflow: Workflow): string {
  const lines = ["name: " + workflow.name, "", "on:", ...workflow.on.map((line) => "  " + line), ""];
  if (workflow.concurrency !== undefined) lines.push("concurrency:", "  group: " + workflow.concurrency, "  cancel-in-progress: true", "");
  lines.push("permissions:", "  contents: read", "");
  if (workflow.env !== undefined) lines.push(...block("", "env", workflow.env), "");
  return [...lines, "jobs:", ...workflow.jobs.flatMap((job, index) => [...(index === 0 ? [] : [""]), ...jobLines(job)]), ""].join("\n");
}

export const HEAD = expression("github.event.pull_request.head.sha || github.sha");
export const TOKEN: Pair = ["GH_TOKEN", expression("github.token")];
export const RUNNER = expression("vars.CI_RUNS_ON || 'ubuntu-latest'");

export type Checkout = { readonly ref?: string; readonly history?: true; readonly credentials?: true };

export const checkout = ({ ref, history, credentials }: Checkout): Step => ({
  uses: CHECKOUT,
  with: [...(ref === undefined ? [] : [["ref", ref] as const]), ...(history === true ? [["fetch-depth", "0"] as const] : []), ...(credentials === true ? [] : [["persist-credentials", "false"] as const])],
});

export const SETUP: Step = { uses: "./.github/actions/setup" };

export const ciCommand = (command: string, head: StepHead, env: readonly Pair[]): Step => ({ ...head, env, run: "bunx checks-ci " + command });

export const DRAFT_HOLD = ciCommand("draft-hold", { name: "cancel the run when a push to a draft pull request started it" }, [TOKEN, ["DRAFT", expression("github.event.pull_request.draft")]]);

export const keepArtifacts = (name: string, path: string): Step => ({
  if: expression("!cancelled()"),
  uses: UPLOAD,
  with: [
    ["name", name],
    ["path", path],
    ["if-no-files-found", "ignore"],
  ],
});

export const claudeInstall = (version: string | undefined): readonly Step[] =>
  version === undefined ? [] : [{ run: scalar("npm install --global @anthropic-ai/claude-code@" + version) }];

export const node24 = (tool: "Wrangler" | "Lighthouse"): Step => ({ note: tool + " needs Node 22 or later, and bunx runs it under whatever node the runner has.", uses: SETUP_NODE, with: [["node-version", "24"]] });

export const servedStep = (origin: string): Step =>
  ciCommand("pages-served", { name: "wait until the origin serves every built file as built" }, [
    ["DIRECTORY", "dist"],
    ["ORIGIN", origin],
    ["ATTEMPTS", '"30"'],
  ]);

export const cloudflare: readonly Pair[] = [
  ["CLOUDFLARE_API_TOKEN", expression("secrets.CLOUDFLARE_API_TOKEN")],
  ["CLOUDFLARE_ACCOUNT_ID", expression("secrets.CLOUDFLARE_ACCOUNT_ID")],
];

export const CLOUDFLARE_SET: Pair = ["CLOUDFLARE_SET", expression("secrets.CLOUDFLARE_API_TOKEN != '' && secrets.CLOUDFLARE_ACCOUNT_ID != ''")];
export const ASTRO_QUIET: Pair = ["ASTRO_TELEMETRY_DISABLED", '"1"'];
export const PREVIEW_PROJECT = expression("env.SITE_PAGES") + "-preview";
export const PREVIEW_MARKER = "<!-- " + PREVIEW_PROJECT + " -->";

export const siteEnv = (names: SiteNames, keys: readonly (keyof SiteNames)[]): readonly Pair[] => keys.map((key) => [SITE_NAME_VARIABLES[key], names[key]]);
