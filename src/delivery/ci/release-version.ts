import { Console, Effect, FileSystem, Schema } from "effect";
import { requiredInput } from "./lib/inputs.ts";
import { writeOutputs } from "./lib/step-output.ts";

const ACTION = "release-version";

class VersionUnread extends Schema.TaggedError<VersionUnread>()("VersionUnread", {
  message: Schema.String,
}) {}

const Manifest = Schema.Struct({ version: Schema.String });

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

function tagFor(version: string): string {
  return `v${version}`;
}

const readVersion = Effect.fn("readVersion")(function* (path: string) {
  const text = yield* (yield* FileSystem.FileSystem)
    .readFileString(path)
    .pipe(Effect.mapError((cause) => new VersionUnread({ message: `${ACTION} cannot read ${path}: ${cause.message}` })));
  const { version } = yield* decodeManifest(text).pipe(
    Effect.mapError((cause) => new VersionUnread({ message: `${path} holds no string version: ${cause.message}` })),
  );
  if (version === "") return yield* new VersionUnread({ message: `${path} holds an empty version` });
  return version;
});

export const main = Effect.gen(function* () {
  const path = yield* requiredInput(ACTION, "package-path", "PACKAGE_PATH");
  const tag = yield* requiredInput(ACTION, "tag", "TAG");
  const version = yield* readVersion(path);
  if (tag !== tagFor(version)) {
    yield* Console.log(`::error::the tag is ${tag}, where ${path} holds ${version} and wants ${tagFor(version)}`);
    return false;
  }
  yield* Console.log(`the tag ${tag} matches ${path}`);
  yield* writeOutputs({ version });
  return true;
});
