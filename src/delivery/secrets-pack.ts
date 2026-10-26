import { Config, ConfigProvider, Effect, FileSystem, Option, Path, Predicate, Schema } from "effect";

const PACK_VARIABLE = "CHECKS_SECRETS_PACK";

const OCTET_BITS = 8;
const OCTET_VALUES = 256;
const ADDRESS_BITS = 32;
const ANY_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])";
const IPV4_RANGE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;

class PackUnreadable extends Schema.TaggedError<PackUnreadable>()("PackUnreadable", {
  message: Schema.String,
}) {}

type Ipv4Range = { readonly octets: readonly number[]; readonly prefix: number };

function ipv4RangeOf(text: string): Option.Option<Ipv4Range> {
  const match = IPV4_RANGE.exec(text);
  if (match === null) return Option.none();
  const [, ...groups] = match;
  const octets = groups.slice(0, 4).map(Number);
  const prefix = groups[4] === undefined ? ADDRESS_BITS : Number(groups[4]);
  if (octets.some((octet) => octet >= OCTET_VALUES) || prefix > ADDRESS_BITS) return Option.none();
  return Option.some({ octets, prefix });
}

// A term reaches gitleaks inside a TOML string, which refuses a raw control character.
const Term = Schema.String.check(Schema.makeFilter((term: string) => (/\S/.test(term) && !/\p{Cc}/u.test(term)) || "is blank or holds a control character"));

const IpRange = Schema.String.check(Schema.makeFilter((text: string) => Option.isSome(ipv4RangeOf(text)) || "is not an IPv4 address or CIDR range"));

const Terms = Schema.optionalKey(Schema.Array(Term));

const Pack = Schema.Struct({
  names: Terms,
  domains: Terms,
  hosts: Terms,
  runners: Terms,
  ipRanges: Schema.optionalKey(Schema.Array(IpRange)),
});

type Pack = typeof Pack.Type;

const decodePack = Schema.decodeUnknownEffect(Schema.fromJsonString(Pack));

type Rule = { readonly id: string; readonly description: string };

const TERM_RULES = [
  ["names", { id: "private-name", description: "A name form the private pack lists" }],
  ["domains", { id: "private-domain", description: "A domain the private pack lists" }],
  ["hosts", { id: "private-host", description: "A host name the private pack lists" }],
  ["runners", { id: "private-runner", description: "A runner name the private pack lists" }],
] as const satisfies readonly (readonly [Exclude<keyof Pack, "ipRanges">, Rule])[];

const IP_RANGE_RULE: Rule = { id: "private-ip-range", description: "An address in an IP range the private pack lists" };

function escaped(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

// RE2's \b is an ASCII word boundary, so it never holds beside a non-ASCII letter or a symbol.
function boundaryAt(character: string | undefined): string {
  return character !== undefined && /\w/.test(character) ? "\\b" : "";
}

function termPattern(term: string): string {
  const trimmed = term.trim();
  return `${boundaryAt(trimmed[0])}${trimmed.split(/\s+/).map(escaped).join("\\s+")}${boundaryAt(trimmed.at(-1))}`;
}

function octetPattern(octet: number, fixedBits: number): string {
  if (fixedBits === OCTET_BITS) return String(octet);
  if (fixedBits === 0) return ANY_OCTET;
  const span = 2 ** (OCTET_BITS - fixedBits);
  const low = octet - (octet % span);
  return `(?:${Array.from({ length: span }, (_, step) => String(low + step)).join("|")})`;
}

function ipRangePattern({ octets, prefix }: Ipv4Range): string {
  const fixedBits = (index: number) => Math.max(0, Math.min(OCTET_BITS, prefix - index * OCTET_BITS));
  return `\\b${octets.map((octet, index) => octetPattern(octet, fixedBits(index))).join("\\.")}\\b`;
}

// JSON writes each string as a TOML basic string reads it, escapes included.
function ruleToml({ id, description }: Rule, patterns: readonly string[]): readonly string[] {
  if (patterns.length === 0) return [];
  const regex = `(?i)(?:${patterns.join("|")})`;
  return [["[[rules]]", `id = ${JSON.stringify(id)}`, `description = ${JSON.stringify(description)}`, `regex = ${JSON.stringify(regex)}`].join("\n")];
}

function packRules(pack: Pack): string {
  const ranges = (pack.ipRanges ?? []).flatMap((text) => Option.toArray(ipv4RangeOf(text)));
  return [
    ...TERM_RULES.flatMap(([kind, rule]) => ruleToml(rule, (pack[kind] ?? []).map(termPattern))),
    ...ruleToml(IP_RANGE_RULE, ranges.map(ipRangePattern)),
  ].join("\n\n");
}

// The path can carry a user name and the pack carries the terms, so no message here names either.
const packRulesAt = Effect.fn("packRulesAt")(function* (file: string) {
  const unreadable = (why: string) => new PackUnreadable({ message: `the private pack ${PACK_VARIABLE} names ${why}, so the gate cannot scan for its terms` });
  if (file === "") return yield* new PackUnreadable({ message: `${PACK_VARIABLE} is set but empty, so it names no private pack and the gate cannot scan for its terms` });
  const read = yield* (yield* FileSystem.FileSystem).readFileString(file).pipe(
    Effect.mapError((cause) => unreadable(Predicate.isTagged(cause.reason, "NotFound") ? "no file that exists" : "a file the gate cannot read")),
  );
  const pack = yield* decodePack(read, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => unreadable("is not the JSON object docs/gates/checks-secrets.md describes")),
  );
  const rules = packRules(pack);
  if (rules === "") return yield* unreadable("lists no term");
  return rules;
});

type ScanConfig = { readonly config: string; readonly notice: string };

export const packConfig = Effect.fn("packConfig")(function* (name: string, scratch: string, file: Option.Option<string>) {
  const path = yield* Path.Path;
  const kitConfig = path.join(import.meta.dir, "gitleaks.toml");
  if (Option.isNone(file)) {
    return { config: kitConfig, notice: `${name}: ${PACK_VARIABLE} is unset, so the kit's rules ran without a private pack` } satisfies ScanConfig;
  }
  const rules = yield* packRulesAt(file.value);
  const fs = yield* FileSystem.FileSystem;
  const config = path.join(scratch, "gitleaks.toml");
  yield* fs.writeFileString(config, `${yield* fs.readFileString(kitConfig)}\n${rules}\n`);
  return { config, notice: `${name}: the kit's rules and the private pack ${PACK_VARIABLE} names ran` } satisfies ScanConfig;
});

export const scanConfig = Effect.fn("scanConfig")(function* (name: string, scratch: string) {
  // Config reads an empty value as unset, and a CI secret that is missing expands to one, so the pack would silently drop.
  const file = yield* Config.option(Config.String(PACK_VARIABLE)).parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }));
  return yield* packConfig(name, scratch, file);
});
