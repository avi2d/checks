#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { git, refArgs } from "./git.ts";
import { runMain } from "./main.ts";
import { readQuality, type Identity } from "./quality-file.ts";

type Commit = {
  readonly sha: string;
  readonly subject: string;
  readonly author: Identity;
  readonly committer: Identity;
  readonly coAuthoredBy: readonly string[];
};

type Offence = { readonly commit: Commit; readonly reasons: readonly string[] };

const DEFAULT_AUTHORS: readonly Identity[] = [{ name: "avi2d", email: "avi2dg@gmail.com" }];

// GitHub writes the squash commit, so it commits what the owner authored and never authors.
const SQUASH_COMMITTER: Identity = { name: "GitHub", email: "noreply@github.com" };

// git's own trailer parser, so only the trailer block counts and prose never does.
const CO_AUTHORED_BY_FORMAT = "%(trailers:key=Co-authored-by)";

// argv cannot carry a NUL, so git spells the separators itself.
const FIELD_FORMAT = "%x00";
const RECORD_FORMAT = "%x1e";
const FIELD = "\u0000";
const RECORD = "\u001e";

const USAGE = "usage: commit-identity.ts <ref> | <base-ref> <head-ref>";

class UnreadableLog extends Schema.TaggedError<UnreadableLog>()("UnreadableLog", {
  message: Schema.String,
}) {}

function render(identity: Identity): string {
  return `${identity.name} <${identity.email}>`;
}

const allowedAuthors = Effect.gen(function* () {
  const { quality } = yield* readQuality((yield* git(["rev-parse", "--show-toplevel"])).trim());
  return quality.commitIdentity?.authors ?? DEFAULT_AUTHORS;
});

const readCommits = Effect.fn("readCommits")(function* (revisions: readonly string[]) {
  const format =
    ["%H", "%an", "%ae", "%cn", "%ce", "%s", CO_AUTHORED_BY_FORMAT].join(FIELD_FORMAT) +
    RECORD_FORMAT;
  const log = yield* git(["log", `--format=${format}`, ...revisions]);

  const commits: Commit[] = [];
  for (const record of log.split(RECORD).map((one) => one.replace(/^\n/, ""))) {
    if (record === "") continue;
    const [sha, authorName, authorEmail, committerName, committerEmail, subject, trailers] = record.split(FIELD);
    if (
      sha === undefined ||
      authorName === undefined ||
      authorEmail === undefined ||
      committerName === undefined ||
      committerEmail === undefined ||
      subject === undefined ||
      trailers === undefined
    ) {
      return yield* new UnreadableLog({ message: `cannot parse git log record: ${JSON.stringify(record)}` });
    }
    commits.push({
      sha,
      subject,
      author: { name: authorName, email: authorEmail },
      committer: { name: committerName, email: committerEmail },
      coAuthoredBy: trailers.split("\n").filter((line) => line !== ""),
    });
  }
  return commits;
});

function allows(allowed: readonly Identity[], identity: Identity): boolean {
  return allowed.some(
    (entry) =>
      entry.name === identity.name &&
      entry.email.toLowerCase() === identity.email.toLowerCase(),
  );
}

function inspect(commit: Commit, allowed: readonly Identity[]): Offence | undefined {
  const reasons: string[] = [];
  if (!allows(allowed, commit.author)) {
    reasons.push(`author ${render(commit.author)}`);
  }
  if (!allows([...allowed, SQUASH_COMMITTER], commit.committer)) {
    reasons.push(`committer ${render(commit.committer)}`);
  }
  for (const trailer of commit.coAuthoredBy) {
    reasons.push(`trailer ${trailer}`);
  }
  return reasons.length === 0 ? undefined : { commit, reasons };
}

const check = Effect.gen(function* () {
  const { first, second } = yield* refArgs(process.argv.slice(2), USAGE);
  const range = second === undefined ? first : `${first}..${second}`;
  const revisions = second === undefined ? ["-1", range] : [range];

  const allowed = yield* allowedAuthors;
  const commits = yield* readCommits(revisions);
  const offences = commits
    .map((commit) => inspect(commit, allowed))
    .filter((offence) => offence !== undefined);

  if (offences.length > 0) {
    const lines = [`commit-identity: ${offences.length} of ${commits.length} commit(s) in ${range} carry a foreign identity:`];
    for (const { commit, reasons } of offences) {
      lines.push(`  ${commit.sha.slice(0, 12)} ${commit.subject}`);
      for (const reason of reasons) lines.push(`    ${reason}`);
    }
    lines.push(`  allowed: ${allowed.map(render).join(", ")}`);
    lines.push(`  allowed as committer only: ${render(SQUASH_COMMITTER)}`);
    yield* Console.error(lines.join("\n"));
    return false;
  }

  yield* Console.log(`commit-identity: ${commits.length} commit(s) in ${range} carry only allowed identities`);
  return true;
});

runMain("commit-identity", check);
