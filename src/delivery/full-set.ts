import { type CallerSet } from "./site-names.ts";
import { type Flake } from "./caller-options.ts";
import { SETUP_NODE, type Step, type Workflow, expression, workflowText, TOKEN, RUNNER, checkout, SETUP, ciCommand, keepArtifacts, claudeInstall } from "./full-set/steps.ts";
import { PULL_REQUEST_HEAD, PULL_REQUEST_NUMBER, BY_HAND, ciWorkflow } from "./full-set/ci.ts";
import { PREVIEW_CLOSE, SITE_MAIN, PRODUCTION } from "./full-set/site.ts";

const PR_TITLE: Workflow = {
  name: "pr-title",
  on: ["pull_request:", "  types: [opened, synchronize, reopened, edited]"],
  concurrency: "pr-title-" + PULL_REQUEST_NUMBER,
  jobs: [
    {
      id: "title",
      runsOn: RUNNER,
      timeout: 10,
      permissions: ["contents: read", "statuses: write", "pull-requests: read"],
      steps: [
        checkout({ ref: PULL_REQUEST_HEAD }),
        SETUP,
        {
          id: "title",
          env: [
            ["PR_TITLE", expression("github.event.pull_request.title")],
            TOKEN,
          ],
          run: "bunx checks-commit-title",
        },
        ciCommand(
          "commit-status",
          { note: "Branch protection reads the title as the commitlint status, which an edit to the title rewrites.", if: "always()", name: "report the commitlint status" },
          [TOKEN, ["HEAD_SHA", PULL_REQUEST_HEAD], ["JOB_STATUS", expression("steps.title.outcome")], ["CONTEXT", "commitlint"], ["ATTEMPTS", '"5"']],
        ),
      ],
    },
  ],
};

const RELEASE: Workflow = {
  name: "release",
  on: BY_HAND,
  jobs: [
    {
      id: "pull-request",
      runsOn: RUNNER,
      timeout: 10,
      concurrency: "release-pull-request",
      permissions: ["contents: write", "pull-requests: write", "actions: write"],
      steps: [
        { note: "A rerun plans the branch tip, not the commit the dispatch named.", ...checkout({ ref: expression("github.ref"), history: true, credentials: true }) },
        SETUP,
        { env: [TOKEN], run: "bunx checks-release-pr ci.yml" },
        ciCommand("held-runs", { name: "delete the runs held for approval on the branch tip" }, [TOKEN, ["BRANCH", "release/" + expression("github.ref_name")]]),
      ],
    },
  ],
};

export type FullWorkflow = { readonly name: string; readonly text: string };

const fileOf = (workflow: Workflow): FullWorkflow => ({ name: workflow.name + ".yml", text: workflowText(workflow) });

// The kit publishes through a release.yml that npm's trusted publishing names, so it keeps its own release files.
export function fullRequiredSet(set: CallerSet, kit: boolean, codeMain: FullWorkflow): readonly FullWorkflow[] {
  const ci = fileOf(ciWorkflow(set, kit));
  if (set.kind === "site") return [ci, fileOf(PR_TITLE), fileOf(PREVIEW_CLOSE(set.names)), fileOf(SITE_MAIN(set.names)), fileOf(RELEASE), fileOf(PRODUCTION(set.names))];
  return kit ? [ci, fileOf(PR_TITLE)] : [ci, fileOf(PR_TITLE), codeMain, fileOf(RELEASE)];
}

export const fullAdvisories = (cron: string | undefined): FullWorkflow =>
  fileOf({
    name: "advisories",
    on: cron === undefined ? BY_HAND : [...BY_HAND, "schedule:", "  - cron: " + JSON.stringify(cron)],
    jobs: [
      {
        id: "advisories",
        runsOn: RUNNER,
        timeout: 15,
        permissions: ["contents: read", "issues: write"],
        steps: [checkout({}), SETUP, { name: "run the scan", env: [TOKEN], run: "bunx checks-advisories --all --issue" }],
      },
    ],
  });

export const fullFlake = ({ nodeVersionFile }: Flake, claudeVersion: string | undefined): FullWorkflow =>
  fileOf({
    name: "flake",
    on: BY_HAND,
    jobs: [
      {
        id: "flake",
        runsOn: RUNNER,
        timeout: 60,
        permissions: ["contents: read"],
        steps: [
          checkout({ history: true }),
          SETUP,
          ...(nodeVersionFile === undefined ? [] : [{ uses: SETUP_NODE, with: [["node-version-file", nodeVersionFile]] } satisfies Step]),
          ...claudeInstall(claudeVersion),
          { run: "bunx checks-flake --runs 10 --report flake-report.json" },
          { ...keepArtifacts("flake-report", "flake-report.json"), with: [["name", "flake-report"], ["path", "flake-report.json"], ["retention-days", "7"], ["if-no-files-found", "ignore"]] },
        ],
      },
    ],
  });

