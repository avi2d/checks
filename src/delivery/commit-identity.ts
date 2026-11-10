#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { ChildProcessSpawner } from "effect/process";
import { releasedVersionOf } from "./release.ts";
import { collect, git, refArgs } from "../core/git.ts";
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

// GitHub writes the squash commit, so it commits what the owner authored and never authors.
const SQUASH_COMMITTER: Identity = { name: "GitHub", email: "noreply@github.com" };

// checks-release-pr commits through the workflow token, which GitHub attributes to its Actions bot.
// GitHub may also name that bot as co-author when it squashes the pull request the bot opened.
const RELEASE_AUTHOR: Identity = { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" };

const DEPENDABOT_AUTHOR: Identity = { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" };

// GitHub's web-flow keys exactly as https://github.com/web-flow.gpg publishes them.
const GITHUB_KEYS = "github-web-flow.gpg";

const SIGNATURE_HEADER = "gpgsig ";

// gpgv exits 0 on a signature by GitHub's expired key as well, and prints GOODSIG only for a live key.
const GOOD_SIGNATURE = /^\[GNUPG:\] GOODSIG /m;

const CO_AUTHOR = /^co-authored-by:\s*(.*?)\s*<([^<>]*)>\s*$/i;

function namesCoAuthor(identity: Identity, trailer: string): boolean {
  const [, name, email = ""] = CO_AUTHOR.exec(trailer) ?? [];
  return name !== undefined && allows([identity], { name, email });
}

// git's own trailer parser, so only the trailer block counts and prose never does.
const CO_AUTHORED_BY_FORMAT = "%(trailers:key=Co-authored-by)";

// argv cannot carry a NUL, so git spells the separators itself.
const FIELD_FORMAT = "%x00";
const RECORD_FORMAT = "%x1e";
const FIELD = "\u0000";
const RECORD = "\u001e";

const USAGE = "usage: commit-identity.ts <ref> | <base-ref> <head-ref>";

class SignatureUnchecked extends Schema.TaggedError<SignatureUnchecked>()("SignatureUnchecked", {
  message: Schema.String,
}) {}

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
  if (!(yield* fs.exists(file))) return [];
  const manifest = yield* fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Authors))));
  return [manifest.author, ...(manifest.contributors ?? [])]
    .filter((entry) => entry !== undefined)
    .map(identityOf)
    .filter((entry) => entry !== undefined);
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

type Signed = { readonly signature: string; readonly payload: string };

// git signs a commit object with its gpgsig header left out, so the payload is rebuilt the same way.
function signedPartsOf(raw: string): Signed | undefined {
  const headerEnd = raw.indexOf("\n\n");
  const headers = (headerEnd === -1 ? raw : raw.slice(0, headerEnd)).split("\n");
  const signature: string[] = [];
  const kept: string[] = [];
  let inSignature = false;
  for (const line of headers) {
    if (line.startsWith(SIGNATURE_HEADER)) {
      inSignature = true;
      signature.push(line.slice(SIGNATURE_HEADER.length));
    } else if (inSignature && line.startsWith(" ")) {
      signature.push(line.slice(1));
    } else {
      inSignature = false;
      kept.push(line);
    }
  }
  if (signature.length === 0) return undefined;
  return { signature: `${signature.join("\n")}\n`, payload: kept.join("\n") + (headerEnd === -1 ? "" : raw.slice(headerEnd)) };
}

const ARMOR_BODY_END = /^(?:=|-----)/;

// gpgv reads only a binary keyring.
const dearmored = Effect.fn("dearmored")(function* (armored: string) {
  const lines = armored.split(/\r?\n/);
  const body = lines.slice(lines.indexOf("") + 1);
  const end = body.findIndex((line) => ARMOR_BODY_END.test(line));
  return yield* Effect.fromResult(Base64.decode(body.slice(0, end === -1 ? body.length : end).join(""))).pipe(
    Effect.mapError(() => new SignatureUnchecked({ message: `the kit's ${GITHUB_KEYS} is not an armored key block` })),
  );
});

// git verify-commit asks gpg, whose keyring any key named GitHub can join, so gpgv checks against GitHub's keys alone.
const gitHubSignatureCheck = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-commit-identity-" });
  const keyring = path.join(scratch, "github.gpg");
  yield* fs.writeFile(keyring, yield* dearmored(yield* fs.readFileString(path.join(import.meta.dir, GITHUB_KEYS))));
  return Effect.fn("signedByGitHub")(function* (sha: string) {
    const signed = signedPartsOf(yield* git(["cat-file", "commit", sha]));
    if (signed === undefined) return false;
    const signatureFile = path.join(scratch, `${sha}.sig`);
    const payloadFile = path.join(scratch, `${sha}.payload`);
    yield* fs.writeFileString(signatureFile, signed.signature);
    yield* fs.writeFileString(payloadFile, signed.payload);
    const { stdout, exitCode } = yield* collect("gpgv", ["--homedir", scratch, "--status-fd", "1", "--keyring", keyring, signatureFile, payloadFile]).pipe(
      Effect.mapError((cause) => new SignatureUnchecked({ message: `gpgv cannot run to check GitHub's signature on ${sha}, so install GnuPG: ${cause.message}` })),
    );
    return exitCode === ChildProcessSpawner.ExitCode(0) && GOOD_SIGNATURE.test(stdout);
  });
});

function namesDependabot(commit: Commit): boolean {
  return allows([DEPENDABOT_AUTHOR], commit.author) || commit.coAuthoredBy.some((trailer) => namesCoAuthor(DEPENDABOT_AUTHOR, trailer));
}

function allows(allowed: readonly Identity[], identity: Identity): boolean {
  return allowed.some(
    (entry) =>
      entry.name === identity.name &&
      entry.email.toLowerCase() === identity.email.toLowerCase(),
  );
}

// GitHub authors a web merge under the account's display name, which the owner's git name need not match.
function allowsEmail(allowed: readonly Identity[], identity: Identity): boolean {
  return allowed.some((entry) => entry.email.toLowerCase() === identity.email.toLowerCase());
}

function authorOffence(commit: Commit, authors: readonly Identity[], signedByGitHub: boolean): string | undefined {
  const madeByGitHub = allows([SQUASH_COMMITTER], commit.committer);
  if (madeByGitHub ? allowsEmail(authors, commit.author) : allows(authors, commit.author)) return undefined;
  // Outside the author list, which a GitHub-made commit matches by email alone and so would take any name on the bot's address.
  if (!allows([DEPENDABOT_AUTHOR], commit.author)) return `author ${render(commit.author)}`;
  return signedByGitHub ? undefined : `author ${render(commit.author)} on a commit GitHub's current key did not sign`;
}

function inspect(commit: Commit, allowed: readonly Identity[], signedByGitHub: boolean): Offence | undefined {
  const release = releasedVersionOf(commit.subject) !== undefined;
  const author = authorOffence(commit, release ? [...allowed, RELEASE_AUTHOR] : allowed, signedByGitHub);
  const reasons = author === undefined ? [] : [author];
  if (!allows([...allowed, SQUASH_COMMITTER], commit.committer)) {
    reasons.push(`committer ${render(commit.committer)}`);
  }
  for (const trailer of commit.coAuthoredBy) {
    if (release && namesCoAuthor(RELEASE_AUTHOR, trailer)) continue;
    if (signedByGitHub && namesCoAuthor(DEPENDABOT_AUTHOR, trailer)) continue;
    reasons.push(`trailer ${trailer}`);
  }
  return reasons.length === 0 ? undefined : { commit, reasons };
}

const check = Effect.gen(function* () {
  const { first, second } = yield* refArgs(process.argv.slice(2), USAGE);
  const range = second === undefined ? first : `${first}..${second}`;
  const revisions = second === undefined ? ["-1", range] : [range];

  const allowed = yield* allowedAuthors;
  if (allowed.length === 0) {
    yield* Console.error("commit-identity: package.json declares no author or contributors, so no identity is allowed; declare the owners there");
    return false;
  }
  const commits = yield* readCommits(revisions);
  const signedByGitHub = commits.some(namesDependabot) ? yield* gitHubSignatureCheck : () => Effect.succeed(false);
  const offences = (
    yield* Effect.forEach(commits, (commit) =>
      (namesDependabot(commit) ? signedByGitHub(commit.sha) : Effect.succeed(false)).pipe(Effect.map((signed) => inspect(commit, allowed, signed))),
    )
  ).filter((offence) => offence !== undefined);

  if (offences.length > 0) {
    const lines = [`commit-identity: ${offences.length} of ${commits.length} commit(s) in ${range} carry a foreign identity:`];
    for (const { commit, reasons } of offences) {
      lines.push(`  ${commit.sha.slice(0, 12)} ${commit.subject}`);
      for (const reason of reasons) lines.push(`    ${reason}`);
    }
    lines.push(`  allowed: ${allowed.map(render).join(", ")}`);
    lines.push(`  allowed as committer only: ${render(SQUASH_COMMITTER)}, which also lets an allowed email author under any name`);
    lines.push(`  allowed as release author only: ${render(RELEASE_AUTHOR)}`);
    lines.push(`  allowed as author or co-author only on a commit GitHub's current key signed: ${render(DEPENDABOT_AUTHOR)}`);
    yield* Console.error(lines.join("\n"));
    return false;
  }

  yield* Console.log(`commit-identity: ${commits.length} commit(s) in ${range} carry only allowed identities`);
  return true;
}).pipe(Effect.scoped);

if (import.meta.main) runMain("commit-identity", check);
