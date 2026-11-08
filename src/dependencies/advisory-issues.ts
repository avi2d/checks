import { Context, Effect, Layer } from "effect";
import { DEFAULT_BRANCH } from "../core/gates.ts";
import { type GitHubFailure, type LabelledIssue, labelledIssues } from "../core/github.ts";
import { summaryOf } from "./advisory-rules.ts";

const LABEL = { name: "advisories", color: "b60205", description: "An advisory the scheduled checks-advisories --all run found" };
const MARKER = "<!-- checks-advisories -->";
const TITLE = `Advisories: bun.lock on ${DEFAULT_BRANCH} fails checks-advisories --all`;

export type Verdict = { readonly kind: "pass" } | { readonly kind: "fail"; readonly report: string };

export type Filed = { readonly issue: number; readonly action: "opened" | "commented on" | "closed" };

export class AdvisoryIssues extends Context.Service<
  AdvisoryIssues,
  {
    readonly ensureLabel: Effect.Effect<void, GitHubFailure>;
    readonly open: Effect.Effect<readonly number[], GitHubFailure>;
    readonly create: (title: string, body: string) => Effect.Effect<number, GitHubFailure>;
    readonly comment: (issue: number, body: string) => Effect.Effect<void, GitHubFailure>;
    readonly close: (issue: number) => Effect.Effect<void, GitHubFailure>;
  }
>()("@avi2dg/checks/dependencies/AdvisoryIssues") {
  static readonly gh = Layer.effect(
    AdvisoryIssues,
    Effect.gen(function* () {
      const { ensureLabel, open, create, comment, close } = yield* labelledIssues(LABEL);
      return AdvisoryIssues.of({ ensureLabel, open: open.pipe(Effect.map(markedIssues)), create, comment, close });
    }),
  );
}

// Only an issue carrying the marker is the run's own, so a person's issue under the label is never commented on or closed.
function markedIssues(issues: readonly LabelledIssue[]): readonly number[] {
  return issues.flatMap(({ number, body }) => (body?.includes(MARKER) === true ? [number] : []));
}

function issueBody(report: string, run: string): string {
  return `The advisories run ${run} failed on ${DEFAULT_BRANCH}:\n\n${summaryOf(report)}\n\n${MARKER}\n`;
}

function failingText(report: string, run: string): string {
  return `The advisories run ${run} still fails:\n\n${summaryOf(report)}\n`;
}

function passingText(run: string): string {
  return `The advisories run ${run} passes, so it closes this issue.`;
}

export const fileVerdict = Effect.fn("fileVerdict")(function* (verdict: Verdict, run: string) {
  const issues = yield* AdvisoryIssues;
  if (verdict.kind === "fail") yield* issues.ensureLabel;
  const open = yield* issues.open;
  const filed: Filed[] = [];
  if (verdict.kind === "fail" && open.length === 0) {
    filed.push({ issue: yield* issues.create(TITLE, issueBody(verdict.report, run)), action: "opened" });
    return filed;
  }
  for (const issue of open) {
    if (verdict.kind === "fail") {
      yield* issues.comment(issue, failingText(verdict.report, run));
      filed.push({ issue, action: "commented on" });
      continue;
    }
    yield* issues.comment(issue, passingText(run));
    yield* issues.close(issue);
    filed.push({ issue, action: "closed" });
  }
  return filed;
});
