import { BunServices } from "@effect/platform-bun";
import { afterEach, expect, test } from "bun:test";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Option, Schema } from "effect";
import { packConfig } from "../../src/delivery/secrets-pack.ts";

const opened: string[] = [];
afterEach(async () => {
  for (const dir of opened.splice(0)) await rm(dir, { recursive: true, force: true });
});

const fake = (prefix: string) => `${prefix}${randomBytes(4).toString("hex")}`;

// The directory name stands in for a user name a pack path can carry, which no message may print.
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `checks-pack-${fake("fakeuser")}-`));
  opened.push(dir);
  return dir;
}

const loaded = (file: Option.Option<string>, dir: string) => Effect.runPromise(Effect.exit(packConfig("secrets", dir, file)).pipe(Effect.provide(BunServices.layer)));

const Rules = Schema.Struct({ rules: Schema.Array(Schema.Struct({ id: Schema.String, regex: Schema.optionalKey(Schema.String) })) });

async function idsOf(pack: unknown): Promise<readonly { readonly id: string; readonly regex?: string }[]> {
  const dir = await scratch();
  await writeFile(join(dir, "pack.json"), JSON.stringify(pack));
  const exit = await loaded(Option.some(join(dir, "pack.json")), dir);
  if (!Exit.isSuccess(exit)) throw new Error("the pack did not load");
  return Schema.decodeUnknownSync(Rules)(Bun.TOML.parse(await readFile(exit.value.config, "utf8"))).rules;
}

// The kit's own rules use RE2 syntax JavaScript lacks, but a pack rule uses only a leading (?i), which JavaScript takes as the i flag.
async function rulesOf(pack: unknown): Promise<ReadonlyMap<string, RegExp>> {
  return new Map(
    (await idsOf(pack)).flatMap(({ id, regex }) => (id.startsWith("private-") && regex !== undefined ? [[id, new RegExp(regex.replace(/^\(\?i\)/, ""), "i")] as const] : [])),
  );
}

const toAddress = (value: number) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");

test("with no pack the kit's rules run alone, and the notice says so", async () => {
  const exit = await loaded(Option.none(), await scratch());
  expect(Exit.isSuccess(exit) && exit.value.config.endsWith(join("src", "delivery", "gitleaks.toml"))).toBe(true);
  expect(Exit.isSuccess(exit) && exit.value.notice).toBe("secrets: CHECKS_SECRETS_PACK is unset, so the kit's rules ran without a private pack");
});

test("a pack set but unable to serve fails closed, and the message names neither the path nor a term", async () => {
  const dir = await scratch();
  const term = fake("Fakeperson");
  const packs: Readonly<Record<string, string>> = {
    "not-json.json": `{${term}`,
    "array.json": JSON.stringify([term]),
    "extra-key.json": JSON.stringify({ names: [term], emails: [term] }),
    "blank-term.json": JSON.stringify({ names: [term, "  "] }),
    "control-character.json": JSON.stringify({ names: [`${term}\u0007`] }),
    "wide-octet.json": JSON.stringify({ names: [term], ipRanges: ["192.0.2.300/24"] }),
    "wide-prefix.json": JSON.stringify({ names: [term], ipRanges: ["198.51.100.0/33"] }),
    "ipv6.json": JSON.stringify({ ipRanges: ["2001:db8::/32"] }),
    "no-key.json": "{}",
    "empty-lists.json": JSON.stringify({ names: [], domains: [], hosts: [], runners: [], ipRanges: [] }),
    "empty-file.json": "",
  };
  for (const [name, text] of Object.entries(packs)) await writeFile(join(dir, name), text);
  await mkdir(join(dir, "a-directory.json"));
  const files = [...Object.keys(packs), "a-directory.json", "missing.json"].map((name) => join(dir, name));

  for (const file of [...files, ""]) {
    const exit = await loaded(Option.some(file), dir);
    const message = Exit.isFailure(exit) ? String(exit.cause) : `loaded ${file}`;
    expect(message).toContain("PackUnreadable");
    expect(message).toContain("the gate cannot scan for its terms");
    expect(message).not.toContain(dir);
    expect(message.toLowerCase()).not.toContain(term.toLowerCase());
  }
});

test("each kind of term gets its own rule, which matches in any case and across whitespace but never inside a longer word", async () => {
  const [first, last, domain, host, runner] = [fake("Fakefirst"), fake("Fakelast"), `${fake("employer")}.example`, `${fake("build-")}.lan`, fake("runner-")];
  const pack = { names: [`${first} ${last}`], domains: [domain], hosts: [host], runners: [runner] };
  expect((await idsOf(pack)).map(({ id }) => id)).toContain("wireguard-key");
  const rules = await rulesOf(pack);
  expect([...rules.keys()].toSorted()).toEqual(["private-domain", "private-host", "private-name", "private-runner"]);
  const matches = (id: string, line: string) => rules.get(id)?.test(line) ?? false;

  expect(matches("private-name", `by ${first.toUpperCase()}\t ${last.toLowerCase()}`)).toBe(true);
  expect(matches("private-name", `${first}${last}`)).toBe(false);
  expect(matches("private-name", `x${first} ${last}`)).toBe(false);
  expect(matches("private-domain", `mail pat@${domain}>`)).toBe(true);
  expect(matches("private-domain", `https://mail.${domain}/inbox`)).toBe(true);
  expect(matches("private-domain", `not${domain}`)).toBe(false);
  expect(matches("private-host", `ssh ${host}`)).toBe(true);
  expect(matches("private-host", `ssh ${host.replace(".lan", "xlan")}`)).toBe(false);
  expect(matches("private-runner", `runs-on: [${runner}]`)).toBe(true);
  expect(matches("private-runner", `runs-on: ${runner}s`)).toBe(false);
});

test("a term carrying regex and TOML syntax matches only itself", async () => {
  const term = `${fake('a.b+c"d\\e(f')}|g`;
  const rule = (await rulesOf({ hosts: [term] })).get("private-host");
  expect(rule?.test(`at ${term} now`)).toBe(true);
  expect(rule?.test(`at ${term.replace(".", "x")} now`)).toBe(false);
  expect(rule?.test("g")).toBe(false);
});

test("an IP range rule matches exactly the addresses whose leading prefix bits equal the range's", async () => {
  for (let round = 0; round < 40; round += 1) {
    const prefix = randomInt(0, 33);
    const base = randomInt(0, 2 ** 32);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const range = prefix === 32 && round % 2 === 0 ? toAddress(base) : `${toAddress(base)}/${prefix}`;
    const rule = (await rulesOf({ ipRanges: [range] })).get("private-ip-range");
    const hostBits = () => (prefix === 32 ? 0 : randomInt(0, 2 ** (32 - prefix)));
    const inside = Array.from({ length: 20 }, () => ((base & mask) | hostBits()) >>> 0);
    const anywhere = Array.from({ length: 20 }, () => randomInt(0, 2 ** 32));
    for (const address of [...inside, ...anywhere]) {
      expect({ range, address: toAddress(address), matched: rule?.test(`peer=${toAddress(address)}:22`) }).toEqual({
        range,
        address: toAddress(address),
        matched: ((address & mask) >>> 0) === ((base & mask) >>> 0),
      });
    }
  }
});

test("an IP range rule never matches an address that only contains one of the range's", async () => {
  const rule = (await rulesOf({ ipRanges: ["198.51.100.0/24"] })).get("private-ip-range");
  expect(rule?.test("198.51.100.8")).toBe(true);
  expect(rule?.test("1198.51.100.8")).toBe(false);
  expect(rule?.test("198.51.100.256")).toBe(false);
  expect(rule?.test("198.51.100")).toBe(false);
});
