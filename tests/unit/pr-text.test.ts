import { expect, test } from "bun:test";
import type { Leak } from "../../src/delivery/gitleaks.ts";
import { report, type Text } from "../../src/delivery/pr-text.ts";

const TEXTS: readonly Text[] = [
  { file: "title", place: "the title", body: "" },
  { file: "body", place: "the body", body: "" },
  { file: "issue-comment-7", place: "https://github.com/owner/repo/pull/3#issuecomment-7", body: "" },
];

const leak = (file: string, StartLine: number, RuleID: string): Leak => ({
  File: `/tmp/checks-pr-text-x/${file}`,
  StartLine,
  RuleID,
  Commit: "",
  Description: `the ${RuleID} rule`,
});

test("the report names each finding by the text it sits in, in the order the pull request shows the texts, then by line", () => {
  expect(report("3", TEXTS, [])).toBe("pr-text: pull request 3 carries no secret and no private term");
  expect(report("3", TEXTS, [leak("issue-comment-7", 1, "private-host"), leak("body", 4, "private-name"), leak("title", 1, "private-domain"), leak("body", 2, "github-pat")]).split("\n")).toEqual([
    "pr-text: pull request 3 carries 4 secret(s) or private term(s); delete each from the text it names, and delete the revision GitHub keeps in that text's edit history:",
    "  the title:1 private-domain: the private-domain rule",
    "  the body:2 github-pat: the github-pat rule",
    "  the body:4 private-name: the private-name rule",
    "  https://github.com/owner/repo/pull/3#issuecomment-7:1 private-host: the private-host rule",
  ]);
});
