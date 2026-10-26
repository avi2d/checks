import { Effect, Schema } from "effect";
import { Usage } from "../core/main.ts";

export const NAME = "checks-vendor";
export const OPENER = "--library";
const USAGE = `usage: ${NAME} [--library <name> --package <package> --repository <remote> --tag <template> [--path <manifest>]]...`;

const Library = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  package: Schema.NonEmptyString,
  repository: Schema.NonEmptyString,
  tag: Schema.String.check(Schema.isPattern(/\{version\}/)),
  path: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^(?:[\w.@+-]+\/)*[\w.@+-]+\.\w+$/))),
});
export type Library = typeof Library.Type;

const Libraries = Schema.Array(Library).check(
  Schema.makeFilter((libraries) => {
    const names = libraries.map(({ name }) => name);
    const repeated = names.find((name, index) => names.indexOf(name) !== index);
    return repeated === undefined || `--library ${repeated} appears more than once`;
  }),
);

const FIELDS = new Map<string, keyof Library>([
  ["--package", "package"],
  ["--repository", "repository"],
  ["--tag", "tag"],
  ["--path", "path"],
]);

function misuse(message: string): Usage {
  return new Usage({ message: `${message}\n${USAGE}` });
}

export const librariesFrom = Effect.fn("librariesFrom")(function* (args: readonly string[]) {
  const groups: Record<string, string>[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? "";
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) return yield* misuse(`${flag} takes a value`);
    if (flag === OPENER) {
      groups.push({ name: value });
      continue;
    }
    const field = FIELDS.get(flag);
    const current = groups.at(-1);
    if (field === undefined) return yield* misuse(`${flag} is not an argument`);
    if (current === undefined) return yield* misuse(`${flag} comes before any ${OPENER}`);
    if (field in current) return yield* misuse(`${flag} appears twice for ${OPENER} ${current["name"]}`);
    current[field] = value;
  }
  return yield* Schema.decodeUnknownEffect(Libraries)(groups).pipe(Effect.mapError((cause) => misuse(cause.message)));
});
