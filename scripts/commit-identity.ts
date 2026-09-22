#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";

type Identity = { readonly name: string; readonly email: string };

type Commit = {
  readonly sha: string;
  readonly subject: string;
  readonly author: Identity;
  readonly committer: Identity;
  readonly message: string;
};

type Offence = { readonly commit: Commit; readonly reasons: readonly string[] };

const DEFAULT_AUTHORS: readonly Identity[] = [{ name: "avi2d", email: "avi2dg@gmail.com" }];

// GitHub writes the squash commit, so it commits what the owner authored and never authors.
const SQUASH_COMMITTER: Identity = { name: "GitHub", email: "noreply@github.com" };

const PERSON_TRAILER_KEYS: ReadonlySet<string> = new Set(["co-authored-by", "signed-off-by"]);
const TRAILER_LINE = /^([A-Za-z][A-Za-z-]*):[ \t]*(\S.*)$/;
const EMAIL_IN_ANGLES = /<[^<>@\s]+@[^<>@\s]+>/;

// argv cannot carry a NUL, so git spells the separators itself.
const FIELD_FORMAT = "%x00";
const RECORD_FORMAT = "%x1e";
const FIELD = "\u0000";
const RECORD = "\u001e";

const USAGE = "usage: commit-identity.ts <ref> | <base-ref> <head-ref>";

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

function git(...args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    die(`commit-identity: git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function render(identity: Identity): string {
  return `${identity.name} <${identity.email}>`;
}

function isIdentity(value: unknown): value is Identity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { name?: unknown; email?: unknown };
  return typeof candidate.name === "string" && typeof candidate.email === "string";
}

function allowedAuthors(): readonly Identity[] {
  const root = git("rev-parse", "--show-toplevel").trim();
  const manifestPath = `${root}/package.json`;
  if (!existsSync(manifestPath)) return DEFAULT_AUTHORS;

  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const configured = (parsed as { commitIdentity?: unknown }).commitIdentity;
  if (configured === undefined) return DEFAULT_AUTHORS;

  const authors = (configured as { authors?: unknown }).authors;
  if (!Array.isArray(authors) || authors.length === 0 || !authors.every(isIdentity)) {
    die(
      `commit-identity: ${manifestPath} sets commitIdentity without a non-empty authors array of {name, email}`,
    );
  }
  return authors;
}

function readCommits(revisions: readonly string[]): readonly Commit[] {
  const format =
    ["%H", "%an", "%ae", "%cn", "%ce", "%s", "%B"].join(FIELD_FORMAT) + RECORD_FORMAT;
  const log = git("log", `--format=${format}`, ...revisions);

  return log
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record !== "")
    .map((record) => {
      const [sha, authorName, authorEmail, committerName, committerEmail, subject, message] =
        record.split(FIELD);
      if (
        sha === undefined ||
        authorName === undefined ||
        authorEmail === undefined ||
        committerName === undefined ||
        committerEmail === undefined ||
        subject === undefined ||
        message === undefined
      ) {
        return die(`commit-identity: cannot parse git log record: ${JSON.stringify(record)}`);
      }
      return {
        sha,
        subject,
        author: { name: authorName, email: authorEmail },
        committer: { name: committerName, email: committerEmail },
        message,
      };
    });
}

function allows(allowed: readonly Identity[], identity: Identity): boolean {
  return allowed.some(
    (entry) =>
      entry.name === identity.name &&
      entry.email.toLowerCase() === identity.email.toLowerCase(),
  );
}

function personTrailers(message: string): readonly string[] {
  const found: string[] = [];
  for (const raw of message.split("\n")) {
    const line = raw.trim();
    const match = TRAILER_LINE.exec(line);
    if (match === null) continue;
    const key = match[1] ?? "";
    const value = match[2] ?? "";
    if (PERSON_TRAILER_KEYS.has(key.toLowerCase()) || EMAIL_IN_ANGLES.test(value)) {
      found.push(line);
    }
  }
  return found;
}

function inspect(commit: Commit, allowed: readonly Identity[]): Offence | undefined {
  const reasons: string[] = [];
  if (!allows(allowed, commit.author)) {
    reasons.push(`author ${render(commit.author)}`);
  }
  if (!allows([...allowed, SQUASH_COMMITTER], commit.committer)) {
    reasons.push(`committer ${render(commit.committer)}`);
  }
  for (const trailer of personTrailers(commit.message)) {
    reasons.push(`trailer ${trailer}`);
  }
  return reasons.length === 0 ? undefined : { commit, reasons };
}

const [first, second, ...extra] = process.argv.slice(2);
if (first === undefined || extra.length > 0) die(USAGE);
const range = second === undefined ? first : `${first}..${second}`;
const revisions = second === undefined ? ["-1", range] : [range];

const allowed = allowedAuthors();
const commits = readCommits(revisions);
const offences = commits
  .map((commit) => inspect(commit, allowed))
  .filter((offence) => offence !== undefined);

if (offences.length > 0) {
  console.error(
    `commit-identity: ${offences.length} of ${commits.length} commit(s) in ${range} carry a foreign identity:`,
  );
  for (const { commit, reasons } of offences) {
    console.error(`  ${commit.sha.slice(0, 12)} ${commit.subject}`);
    for (const reason of reasons) console.error(`    ${reason}`);
  }
  console.error(`  allowed: ${allowed.map(render).join(", ")}`);
  console.error(`  allowed as committer only: ${render(SQUASH_COMMITTER)}`);
  process.exit(1);
}

console.log(`commit-identity: ${commits.length} commit(s) in ${range} carry only allowed identities`);
