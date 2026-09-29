#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { releasedVersionOf } from "./release.ts";
import { git, refArgs } from "../core/git.ts";
import { runMain } from "../core/main.ts";

type Identity = { readonly name: string; readonly email: string };

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

// checks-release-pr commits through the workflow token, which GitHub attributes to its Actions bot.
// GitHub may also name that bot as co-author when it squashes the pull request the bot opened.
const RELEASE_AUTHOR: Identity = { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" };

const CO_AUTHOR = /^co-authored-by:\s*(.*?)\s*<([^<>]*)>\s*$/i;

function namesReleaseAuthor(trailer: string): boolean {
  const [, name, email = ""] = CO_AUTHOR.exec(trailer) ?? [];
  return name !== undefined && allows([RELEASE_AUTHOR], { name, email });
}

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

const Person = Schema.Union([
  Schema.String,
  Schema.Struct({
    name: Schema.String,
    email: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }),
]);
const Authors = Schema.Struct({
  author: Schema.optionalKey(Person),
  contributors: Schema.optionalKey(Schema.Array(Person)),
});

function identityOf(person: typeof Person.Type): Identity | undefined {
  const name = typeof person === "string" ? (/^[^(<]*/.exec(person)?.[0] ?? "").trim() : person.name;
  const email = typeof person === "string" ? /<([^<>]+)>/.exec(person)?.[1] : person.email;
  return name === "" || email === undefined || email === "" ? undefined : { name, email };
}

const allowedAuthors = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, "package.json");
  if (!(yield* fs.exists(file))) return DEFAULT_AUTHORS;
  const manifest = yield* fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Authors))));
  const listed = [manifest.author, ...(manifest.contributors ?? [])]
    .filter((entry) => entry !== undefined)
    .map(identityOf)
    .filter((entry) => entry !== undefined);
  return listed.length === 0 ? DEFAULT_AUTHORS : listed;
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
  const release = releasedVersionOf(commit.subject) !== undefined;
  const authors = release ? [...allowed, RELEASE_AUTHOR] : allowed;
  if (!allows(authors, commit.author)) {
    reasons.push(`author ${render(commit.author)}`);
  }
  if (!allows([...allowed, SQUASH_COMMITTER], commit.committer)) {
    reasons.push(`committer ${render(commit.committer)}`);
  }
  for (const trailer of commit.coAuthoredBy) {
    if (release && namesReleaseAuthor(trailer)) continue;
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
    lines.push(`  allowed as release author only: ${render(RELEASE_AUTHOR)}`);
    yield* Console.error(lines.join("\n"));
    return false;
  }

  yield* Console.log(`commit-identity: ${commits.length} commit(s) in ${range} carry only allowed identities`);
  return true;
});

if (import.meta.main) runMain("commit-identity", check);
