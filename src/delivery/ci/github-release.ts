import { Console, Effect, FileSystem, Schema } from "effect";
import { github, repositoryFromEnv, type Repository } from "./lib/github.ts";
import { InputMissing, optionalInput, requiredInput } from "./lib/inputs.ts";

const ACTION = "github-release";
const PAGE_SIZE = 100;
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:[-+].*)?$/;

class NotesUnread extends Schema.TaggedError<NotesUnread>()("NotesUnread", {
  message: Schema.String,
}) {}

const Release = Schema.Struct({ id: Schema.Finite, tag_name: Schema.String });
type Release = typeof Release.Type;
const Releases = Schema.Array(Release);
const Created = Schema.Struct({ id: Schema.Finite });

export function highestTag(tags: readonly string[]): string | undefined {
  return tags
    .filter((tag) => RELEASE_TAG.test(tag))
    .reduce<string | undefined>((best, tag) => (best === undefined || Bun.semver.order(tag.slice(1), best.slice(1)) === 1 ? tag : best), undefined);
}

export type ReleaseCall = {
  readonly method: "PATCH" | "POST";
  readonly path: string;
  readonly body: {
    readonly tag_name: string;
    readonly name: string;
    readonly body: string;
    readonly draft: false;
    readonly prerelease: false;
    readonly make_latest: "true" | "false";
  };
};

export function releaseCall(releases: readonly Release[], tag: string, notes: string): ReleaseCall {
  const existing = releases.find((release) => release.tag_name === tag);
  const latest = highestTag([...releases.map((release) => release.tag_name), tag]) === tag;
  return {
    method: existing === undefined ? "POST" : "PATCH",
    path: existing === undefined ? "/releases" : `/releases/${existing.id}`,
    body: { tag_name: tag, name: tag, body: notes, draft: false, prerelease: false, make_latest: latest ? "true" : "false" },
  };
}

const listReleases = Effect.fn("listReleases")(function* (repository: Repository) {
  const releases: Release[] = [];
  for (let page = 1; ; page += 1) {
    const batch = yield* github(repository, Releases, "GET", `/releases?per_page=${PAGE_SIZE}&page=${page}`);
    releases.push(...batch);
    if (batch.length < PAGE_SIZE) return releases;
  }
});

export const main = Effect.gen(function* () {
  const repository = yield* repositoryFromEnv(ACTION);
  const tag = yield* optionalInput("TAG");
  if (tag === "") return yield* new InputMissing({ message: `${ACTION} needs the tag the run started on, and it is empty` });
  const refType = yield* optionalInput("REF_TYPE");
  if (refType !== "tag") {
    yield* Console.log(`::error::${ACTION} runs only on a tag, and ref_type is ${refType === "" ? "empty" : refType}`);
    return false;
  }
  const notesFile = yield* requiredInput(ACTION, "notes-file", "NOTES_FILE");
  const notes = yield* (yield* FileSystem.FileSystem)
    .readFileString(notesFile)
    .pipe(Effect.mapError((cause) => new NotesUnread({ message: `${ACTION} cannot read ${notesFile}: ${cause.message}` })));
  const call = releaseCall(yield* listReleases(repository), tag, notes);
  const { id } = yield* github(repository, Created, call.method, call.path, call.body);
  yield* Console.log(`${call.method === "POST" ? "created" : "updated"} the ${tag} release ${id}, latest ${call.body.make_latest}`);
  return true;
});
