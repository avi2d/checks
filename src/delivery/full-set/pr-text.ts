import { type Workflow, expression, TOKEN, HOSTED, checkout, SETUP, ciCommand } from "./steps.ts";

const NUMBER = expression("github.event.pull_request.number || github.event.issue.number");

// An issue comment on no pull request has nothing to scan, and a fork's review gets no secret, so the scan would skip it.
const SCANNED = "(github.event_name != 'issue_comment' || github.event.issue.pull_request) && (!startsWith(github.event_name, 'pull_request_review') || github.event.pull_request.head.repo.full_name == github.repository)";

const SKIPPED = "steps.pack.outputs.configured == 'false'";

export const PR_TEXT: Workflow = {
  name: "pr-text",
  on: [
    "# pull_request withholds secrets from forks, so this job must never check out pull request code.",
    "pull_request_target:",
    "  types: [opened, edited, synchronize, reopened]",
    "issue_comment:",
    "  types: [created, edited, deleted]",
    "# GitHub withholds secrets from a fork's review, so the job skips it and another trigger scans the text.",
    "pull_request_review:",
    "  types: [submitted, edited]",
    "pull_request_review_comment:",
    "  types: [created, edited, deleted]",
  ],
  jobs: [
    {
      id: "pr-text",
      if: SCANNED,
      runsOn: HOSTED,
      timeout: 10,
      concurrency: "pr-text-" + NUMBER,
      cancelInProgress: true,
      permissions: ["contents: read", "issues: read", "pull-requests: read", "statuses: write"],
      env: [TOKEN, ["NUMBER", NUMBER]],
      steps: [
        checkout({ ref: expression("github.event.repository.default_branch") }),
        SETUP,
        ciCommand("secrets-pack", { note: "Only the repository secret decides the skip, and no pull request value reaches this step.", id: "pack", name: "write the private pack or skip when none is configured" }, [
          ["PACK", expression("secrets.CHECKS_SECRETS_PACK")],
          ["IF_MISSING", "skip"],
        ]),
        { id: "scan", if: "steps.pack.outputs.configured == 'true'", run: 'bunx checks-pr-text "$NUMBER"' },
        ciCommand("commit-status", { note: "A comment's run reports on no pull request, so this posts a commit status.", if: expression("!cancelled()"), name: "report the result on the head commit" }, [
          ["CONTEXT", "pr-text"],
          ["PULL_REQUEST", NUMBER],
          ["JOB_STATUS", expression(SKIPPED + " && 'success' || steps.scan.outcome")],
          ["DESCRIPTION", JSON.stringify(expression(SKIPPED + " && 'scan skipped: no private pack is configured (CHECKS_SECRETS_PACK is unset)' || steps.scan.outcome == 'success' && 'the scan passed' || 'the scan failed or did not run'"))],
        ]),
      ],
    },
  ],
};
