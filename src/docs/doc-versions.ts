import { Effect, Option, Schema } from "effect";
import { git } from "../core/git.ts";
import { PACKAGE_MANIFEST } from "./doc-references.ts";
import { scanMarkdown, type MarkdownLine } from "./prose-matchers.ts";

type Pin = { readonly name: string | undefined; readonly version: string; readonly holder: string };

const BUN_VERSION = ".bun-version";

const Group = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));
const Manifest = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  packageManager: Schema.optionalKey(Schema.String),
  engines: Group,
  dependencies: Group,
  devDependencies: Group,
  peerDependencies: Group,
  optionalDependencies: Group,
});
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest));
const NO_MANIFEST: typeof Manifest.Type = {};

const VERSION = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
const ONE_VERSION = new RegExp(String.raw`^[\^~=v]?(${VERSION.source})$`);
const VERSIONS = new RegExp(VERSION.source, "g");

function namedPins(group: Readonly<Record<string, string>> | undefined): readonly Pin[] {
  return Object.entries(group ?? {}).flatMap(([name, range]) => {
    const version = ONE_VERSION.exec(range.trim())?.[1];
    return version === undefined ? [] : [{ name, version, holder: PACKAGE_MANIFEST }];
  });
}

function barePins(value: string | undefined, holder: string): readonly Pin[] {
  return [...(value ?? "").matchAll(VERSIONS)].map(([version]) => ({ name: undefined, version, holder }));
}

export function pinsOf(manifest: string, bunVersion: string): readonly Pin[] {
  const { version, packageManager, engines = {}, dependencies, devDependencies, peerDependencies, optionalDependencies } = Option.getOrElse(
    decodeManifest(manifest),
    () => NO_MANIFEST,
  );
  const pins = [
    ...[dependencies, devDependencies, peerDependencies, optionalDependencies].flatMap(namedPins),
    ...[version, packageManager, ...Object.values(engines)].flatMap((value) => barePins(value, PACKAGE_MANIFEST)),
    ...barePins(bunVersion, BUN_VERSION),
  ];
  return pins.filter((pin, index) => pins.findIndex((other) => other.name === pin.name && other.version === pin.version) === index);
}

function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);
}

// A longer version that only opens with the pin, as 1.2.30 or 1.2.3-beta, is another version.
const VERSION_END = String.raw`(?![\w-]|\.\d)`;

function patternOf({ name, version }: Pin): RegExp {
  const written =
    name === undefined ? String.raw`(?<![\w.+-])v?${escaped(version)}` : String.raw`(?<![\w@/.-])${escaped(name)}@[\^~]?${escaped(version)}`;
  return new RegExp(written + VERSION_END, "g");
}

const GENERATED_OPEN = /^\s*<!-- generated ([\w-]+):/;
const GENERATED_CLOSE = /^\s*<!-- end generated ([\w-]+) -->/;

function handWritten(lines: readonly MarkdownLine[]): readonly MarkdownLine[] {
  const exempt = new Set<number>();
  let at = 0;
  while (at < lines.length) {
    const opening = lines[at]?.kind === "code" ? null : GENERATED_OPEN.exec(lines[at]?.raw ?? "");
    if (opening === null) {
      at += 1;
      continue;
    }
    const closeAt = lines.findIndex(
      (line, index) => index > at && line.kind !== "code" && GENERATED_CLOSE.exec(line.raw)?.[1] === opening[1],
    );
    if (closeAt < 0) {
      at += 1;
      continue;
    }
    for (let index = at; index <= closeAt; index += 1) exempt.add(index);
    at = closeAt + 1;
  }
  return lines.filter((_, index) => !exempt.has(index));
}

type Copy = { readonly at: number; readonly end: number; readonly pin: Pin; readonly written: string };

function namePresent(raw: string, name: string): boolean {
  return new RegExp(String.raw`(?<![\w@/.-])${escaped(name)}(?![\w/.-])`, "i").test(raw);
}

function barePatternFor(version: string): RegExp {
  return new RegExp(String.raw`(?<![\w.+-])v?${escaped(version)}` + VERSION_END, "g");
}

// A bare pin inside a named copy, as 1.2.3 in zod@1.2.3, is the same copy.
function copiesIn(raw: string, pins: readonly Pin[]): readonly Copy[] {
  const found: Copy[] = [];
  for (const pin of pins) {
    for (const match of raw.matchAll(patternOf(pin))) {
      const at = match.index;
      found.push({ at, end: at + match[0].length, pin, written: match[0] });
    }
    if (pin.name !== undefined && namePresent(raw, pin.name)) {
      for (const match of raw.matchAll(barePatternFor(pin.version))) {
        const at = match.index;
        found.push({ at, end: at + match[0].length, pin, written: match[0] });
      }
    }
  }
  const installed = found.filter((copy) => copy.written.includes("@"));
  return found
    .filter((copy) => copy.written.includes("@") || !installed.some(({ at, end }) => copy.at >= at && copy.end <= end))
    .toSorted((a, b) => a.at - b.at);
}

export function versionFindings(text: string, pins: readonly Pin[], within?: ReadonlySet<number>): readonly { readonly line: number; readonly message: string }[] {
  if (pins.length === 0) return [];
  return handWritten(scanMarkdown(text))
    .filter(({ line }) => within === undefined || within.has(line))
    .flatMap(({ line, raw }) =>
      copiesIn(raw, pins).map(({ written, pin }) => ({
        line,
        message: `carries \`${written}\`, a version ${pin.holder} pins. Name ${pin.holder} instead, or let a build write the line between generated markers`,
      })),
    );
}

const readAt = (root: string, head: string, path: string) =>
  git(["show", `${head}:${path}`], root).pipe(Effect.catchTag("GitFailure", () => Effect.succeed("")));

export const pinsAt = Effect.fn("pinsAt")(function* (root: string, head: string) {
  return pinsOf(yield* readAt(root, head, PACKAGE_MANIFEST), yield* readAt(root, head, BUN_VERSION));
});
