import { $ } from "bun";
import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, lintWiring, ran, scratchDirs, type FixtureRepo } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-secrets-");
const scratch = scratchDirs();
const GATE = "delivery/secrets.ts";
const SCAN_MS = 120_000;

// Each secret is assembled at run time, so the kit's own scan finds none in this file.
const base64Key = () => randomBytes(32).toString("base64");
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const alphanumeric = (length: number) => randomBytes(length * 2).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, length);
const link = (scheme: string, rest: string) => `${scheme}://${rest}`;
const withPadding = (text: string) => Buffer.from(text + " ".repeat((4 - (text.length % 3)) % 3)).toString("base64");
const armor = (edge: string) => `-----${edge} OPENSSH PRIVATE KEY-----`;
const HOST = "vpn.home-fixture.net";

function planted(): Readonly<Record<string, string>> {
  return {
    "vpn/wg0.conf": `[Interface]\nPrivateKey = ${base64Key()}\n\n[Peer]\nPublicKey = ${base64Key()}\nPresharedKey = ${base64Key()}\n`,
    "vpn/awg0.json": JSON.stringify({ privateKey: base64Key(), jc: 4 }),
    "deploy/key": `${armor("BEGIN")}\n${randomBytes(300).toString("base64")}\n${armor("END")}\n`,
    ".env": `GITHUB_TOKEN=${["gh", "p_"].join("")}${alphanumeric(36)}\n`,
  };
}

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  "vpn/wg0.conf": "[Interface]\nPrivateKey = <private-key>\n\n[Peer]\nPublicKey = <server-public-key>\nPresharedKey = ${WG_PRESHARED_KEY}\n",
  "vpn/awg0.json": JSON.stringify({ privateKey: "<private-key>", jc: 4 }),
  "deploy/key": "<ssh-private-key>\n",
  ".env": "GITHUB_TOKEN=<github-token>\n",
};

type Case = { readonly file: string; readonly line: string; readonly rules: readonly string[] };

function cases(): readonly Case[] {
  const vmess = Buffer.from(JSON.stringify({ v: "2", add: HOST, port: "443", id: randomUUID(), net: "ws" })).toString("base64");
  const shadowsocks = Buffer.from(`chacha20-ietf-poly1305:${hex(12)}`).toString("base64");
  const legacyShadowsocks = Buffer.from(`chacha20-ietf-poly1305:${hex(12)}@${HOST}:8388`).toString("base64");
  const paddedVmess = withPadding(JSON.stringify({ v: "2", add: HOST, port: "443", id: randomUUID(), net: "ws" }));
  const paddedShadowsocks = withPadding(`chacha20-ietf-poly1305:${hex(12)}@${HOST}:8388`);
  const userinfo = ["proxy-userinfo-link"];
  const base64 = ["proxy-base64-link"];
  const firstQuery = ["proxy-query-credential-first"];
  const lastQuery = ["proxy-query-credential-last"];
  const query = [...firstQuery, ...lastQuery];
  const key = ["wireguard-key"];
  const keyFile = ["wireguard-key-file"];
  const dotKeyFile = ["wireguard-dot-key-file"];
  const passes: readonly string[] = [];
  const lines: readonly Omit<Case, "file">[] = [
    { line: link("vless", `${randomUUID()}@${HOST}:443?security=reality#home`), rules: userinfo },
    { line: link("ss", `${shadowsocks}@${HOST}:8388#home`), rules: userinfo },
    { line: link("trojan", `${hex(12)}@${HOST}:443#home`), rules: userinfo },
    { line: link("socks5", `home:${hex(12)}@${HOST}:1080`), rules: userinfo },
    { line: link("socks5h", `home:${hex(12)}@${HOST}:1080`), rules: userinfo },
    { line: link("vmess", `${randomUUID()}@${HOST}:443?type=ws#home`), rules: userinfo },
    { line: link("wireguard", `${encodeURIComponent(base64Key())}@${HOST}:51820?address=10.0.0.2/32&mtu=1280#home`), rules: userinfo },
    { line: link("wg", `${HOST}:51820?pk=${base64Key()}&local_address=10.0.0.2/32&peer_pk=${base64Key()}#home`), rules: query },
    { line: link("wg", `${HOST}:51820?pk=${encodeURIComponent(base64Key())}&peer_pk=${encodeURIComponent(base64Key())}#home`), rules: query },
    { line: link("vmess", vmess), rules: base64 },
    { line: `Import this link: ${link("vmess", vmess)}.`, rules: base64 },
    { line: `${link("vmess", vmess)}: that one`, rules: base64 },
    { line: link("ss", `${legacyShadowsocks}#home`), rules: base64 },
    { line: `Legacy: ${link("ss", legacyShadowsocks)}.`, rules: base64 },
    { line: `${link("vmess", paddedVmess)}—the link`, rules: base64 },
    { line: `${link("ss", paddedShadowsocks)}—see below`, rules: base64 },
    { line: `| ${link("vmess", paddedVmess)}|`, rules: base64 },
    { line: `| ${link("ss", paddedShadowsocks)}|`, rules: base64 },
    { line: `${link("vmess", paddedVmess)}-see below`, rules: base64 },
    { line: `${link("ss", paddedShadowsocks)}-see below`, rules: base64 },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=${hex(12)}&upmbps=100#home`), rules: query },
    { line: link("hysteria", `${HOST}:443?protocol=udp&obfsParam=${hex(12)}#home`), rules: query },
    { line: link("hysteria2", `<password>@${HOST}:443/?obfs=salamander&obfs-password=${hex(12)}`), rules: query },
    { line: link("hysteria2", `pw@${HOST}:443/?obfs=salamander&obfs-password=${hex(12)}`), rules: query },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=${hex(12)}&upmbps=100&obfsParam=pw#home`), rules: firstQuery },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=${hex(12)}&upmbps=100&obfsParam=\${OBFS}#home`), rules: firstQuery },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=${hex(12)}&upmbps=100&obfsParam={{ obfs }}#home`), rules: firstQuery },
    { line: link("hysteria2", `pw@${HOST}:443/?obfs=salamander&obfs-password=${hex(12)}&password=pw`), rules: firstQuery },
    { line: link("wg", `${HOST}:51820?pk=${base64Key()}&password=x`), rules: firstQuery },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=pw&upmbps=100&obfsParam=${hex(12)}#home`), rules: lastQuery },
    { line: link("hysteria", `${HOST}:443?protocol=udp&peer=<sni>&auth=${hex(12)}#home`), rules: query },
    { line: link("wg", `${HOST}:51820?peer_pk=<server-public-key>&pk=${base64Key()}#home`), rules: query },
    { line: link("hysteria2", `pw@${HOST}:443/?sni=<sni>&obfs=salamander&obfs-password=${hex(12)}`), rules: query },
    { line: `${link("hysteria", "vpn.example.com:443?auth=<password>")} ${link("hysteria", `${HOST}:443?auth=${hex(12)}`)}`, rules: query },
    { line: JSON.stringify([link("hysteria", "vpn.example.com:443?auth=x"), link("wg", `${HOST}:51820?pk=${base64Key()}`)]), rules: query },
    { line: link("https", `panel.home-fixture.net/sub/${hex(16)}`), rules: ["proxy-subscription-url"] },
    { line: link("https", `panel.home-fixture.net/sub?token=${hex(16)}&key=${"a".repeat(20)}`), rules: ["proxy-subscription-url"] },
    { line: `client_psk: ${base64Key()}`, rules: key },
    { line: `wireguard_psk: ${base64Key()}`, rules: key },
    { line: `wg_private_key: ${base64Key()}`, rules: key },
    { line: `ALL_PROXY=${link("socks5", "127.0.0.1:1080")}`, rules: passes },
    { line: `proxy: ${link("socks5", "localhost:1080")}`, rules: passes },
    { line: link("ss", "homevpnserver-fixture.net:8388"), rules: passes },
    { line: link("ss", "homevpnserverfixture1:8388"), rules: passes },
    { line: link("vmess", `${HOST}:443`), rules: passes },
    { line: link("vmess", "<base64-config>"), rules: passes },
    { line: link("vless", "<uuid>@vpn.example.com:443?security=reality#home"), rules: passes },
    { line: link("vmess", `${randomUUID()}@vpn.example.com:443?type=ws#home`), rules: passes },
    { line: link("wireguard", "<private-key>@vpn.example.com:51820"), rules: passes },
    { line: link("trojan", `pw@${HOST}:443#home`), rules: passes },
    { line: link("socks5", `user@${HOST}:1080`), rules: passes },
    { line: link("trojan", "fixturepassword@vpn.example.com:443#home"), rules: passes },
    { line: link("trojan", `\${TROJAN_PASSWORD}@${HOST}:443#home`), rules: passes },
    { line: link("hysteria", "vpn.example.com:443?protocol=udp&auth=<password>#home"), rules: passes },
    { line: link("hysteria", "vpn.example.com:443?protocol=udp&auth=fixturepassword#home"), rules: passes },
    { line: link("hysteria2", "pw@vpn.example.com:443/?obfs=salamander&obfs-password=fixturepassword"), rules: passes },
    { line: link("hysteria", "vpn.example.com:443?protocol=udp&auth=fixturepassword&obfsParam=fixtureobfs#home"), rules: passes },
    { line: link("https", `files.home-fixture.net/open?id=${hex(16)}`), rules: passes },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=\${HYSTERIA_AUTH}#home`), rules: passes },
    { line: link("hysteria", `${HOST}:443?protocol=udp&upmbps=100#home`), rules: passes },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=pw#home`), rules: passes },
    { line: `f"${link("trojan", "{password}@{host}:443")}"`, rules: passes },
    { line: `f"${link("vless", "{client.uuid}@{host}:443")}"`, rules: passes },
    { line: `f"${link("hysteria", "{host}:443?auth={auth}")}"`, rules: passes },
    { line: `\`${link("trojan", "${peer.password}@${host}:443")}\``, rules: passes },
    { line: `\`${link("wg", "${host}:51820?pk=${peer.privateKey}")}\``, rules: passes },
    { line: `curl -x "${link("socks5h", "$PROXY_USER:$PROXY_PASS@proxy.home-fixture.net:1080")}"`, rules: passes },
    { line: `\`${link("hysteria", "${host}:443?auth=${hex(12)}&obfsParam=${encodeURIComponent(obfs)}")}\``, rules: passes },
    { line: `\`${link("trojan", "${base64Key()}@${host}:443")}\``, rules: passes },
    { line: `fetch(\`${link("https", "api.home-fixture.net/login?user=${user}&password=${encodeURIComponent(password)}")}\`)`, rules: passes },
    { line: `\`${link("wg", '${host}:51820?pk=${encodeURIComponent(peer.privateKey.toString("base64"))}&peer_pk=${pub}')}\``, rules: passes },
    { line: `\`${link("hysteria", '${host}:443?auth=${auth ?? ""}')}\``, rules: passes },
    { line: `\`${link("hysteria", "${host}:443?auth=${enc(a, b)}")}\``, rules: passes },
    { line: `\`${link("hysteria", '${host}:443?auth=${encodeURIComponent("a b")}')}\``, rules: passes },
    { line: link("hysteria", "{{host}}:443?auth={{ hysteria_auth }}"), rules: passes },
    ...["${pass}", "${pass:-}", "${pass-}", "${pass:?required}", "$PASS", "$pass", "$PROXY_PASS", "{{ password }}", "{{password}}", "%(password)s", "<password>"].flatMap(
      (reference) => [
        { line: link("trojan", `${reference}@${HOST}:443#home`), rules: passes },
        { line: link("hysteria", `${HOST}:443?protocol=udp&auth=${reference}#home`), rules: passes },
      ],
    ),
    { line: `curl -x "${link("socks5h", `\${PROXY_USER}:\${PROXY_PASS:-}@${HOST}:1080`)}"`, rules: passes },
    { line: `LINK="${link("hysteria", `${HOST}:443?auth=\${HY_AUTH:?set HY_AUTH}`)}"`, rules: passes },
    { line: link("trojan", `$1${hex(12)}@${HOST}:443#home`), rules: userinfo },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=$1${hex(12)}#home`), rules: query },
    { line: link("trojan", `${hex(12)}:{x}@${HOST}:443#home`), rules: userinfo },
    { line: link("trojan", `${hex(12)}:\${PASS}@${HOST}:443#home`), rules: userinfo },
    { line: link("trojan", `\${PASS:-${hex(12)}}@${HOST}:443#home`), rules: userinfo },
    { line: link("trojan", `\${PASS-${hex(12)}}@${HOST}:443#home`), rules: userinfo },
    { line: link("hysteria", `${HOST}:443?protocol=udp&auth=\${HY_AUTH:-${hex(12)}}#home`), rules: query },
    { line: link("https", "panel.example.com/sub/0123456789abcdef0123456789abcdef"), rules: passes },
    { line: "client_psk: <preshared-key>", rules: passes },
    { line: link("wg", `${HOST}:51820?pk=<private-key>&peer_pk=${base64Key()}#home`), rules: passes },
    { line: base64Key(), rules: passes },
  ];
  return [
    ...lines.map((row) => ({ file: "vpn/cases.txt", ...row })),
    { file: "wg/privatekey", line: base64Key(), rules: keyFile },
    { file: "wg/wg0.key", line: base64Key(), rules: dotKeyFile },
    { file: "wg/wg0-private.key", line: base64Key(), rules: [...keyFile, ...dotKeyFile] },
    { file: "wg/client_private_key", line: base64Key(), rules: keyFile },
    { file: "wg/presharedkey", line: base64Key(), rules: keyFile },
    { file: "wg/psk", line: base64Key(), rules: keyFile },
    { file: "wg/pubserver-privatekey", line: base64Key(), rules: keyFile },
    { file: "wg/republic_privatekey", line: base64Key(), rules: keyFile },
    { file: "wg/server-privkey.pubkey", line: base64Key(), rules: keyFile },
    { file: "wg/psk.pub.key", line: base64Key(), rules: keyFile },
    { file: "wg/priv.public.key", line: base64Key(), rules: keyFile },
    { file: "wg/publickey", line: base64Key(), rules: passes },
    { file: "wg/server-public.key", line: base64Key(), rules: passes },
    { file: "wg/server_pub.key", line: base64Key(), rules: passes },
    { file: "wg/client.pubkey", line: base64Key(), rules: passes },
    { file: "wg/peer.pub", line: base64Key(), rules: passes },
    { file: "wg/client.privatekey", line: "<private-key>", rules: passes },
  ];
}

function rulesByPlace(report: string): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const [, place, rule] of report.matchAll(/^ {2}(\S+:\d+) (\S+) in /gm)) {
    found.set(place ?? "", [...new Set(found.get(place ?? "")).add(rule ?? "")].toSorted());
  }
  return found;
}

function linesByFile(table: readonly Case[]): Readonly<Record<string, string>> {
  return Object.fromEntries(Map.groupBy(table, (row) => row.file).entries().map(([file, rows]) => [file, `${rows.map((row) => row.line).join("\n")}\n`]));
}

async function started(): Promise<{ readonly repo: FixtureRepo; readonly base: string }> {
  const repo = await open({ "README.md": "# fixture\n" });
  return { repo, base: await repo.commit("chore: start") };
}

// Each side writes its own files, and the merge stops before its commit so the test writes the resolution.
async function diverged(files: {
  readonly topic: Readonly<Record<string, string>>;
  readonly main: Readonly<Record<string, string>>;
}): Promise<{ readonly repo: FixtureRepo; readonly main: string }> {
  const { repo } = await started();
  await $`git switch -q -c topic`.cwd(repo.dir).quiet();
  await repo.write(files.topic);
  await repo.commit("feat: topic side");
  await $`git switch -q main`.cwd(repo.dir).quiet();
  await repo.write(files.main);
  const main = await repo.commit("feat: main side");
  await $`git switch -q topic && git merge -q --no-ff --no-commit main`.cwd(repo.dir).nothrow().quiet();
  return { repo, main };
}

test(
  "a range adding a real secret in a config file, a key file or an env file fails on each, and the same files with placeholders pass",
  async () => {
    const { repo, base } = await started();
    await repo.write(planted());
    const head = await repo.commit("feat: plant secrets");
    const failed = await repo.script(GATE, base, head);
    expect(failed.exitCode).toBe(1);
    expect(failed.text).toContain("secrets: the range adds 5 secret(s)");
    for (const place of [
      "vpn/wg0.conf:2 wireguard-key",
      "vpn/wg0.conf:6 wireguard-key",
      "vpn/awg0.json:1 wireguard-key",
      "deploy/key:1 private-key",
      ".env:1 github-pat",
    ]) {
      expect(failed.text).toContain(`  ${place} in ${head.slice(0, 8)}`);
    }

    const clean = await started();
    await clean.repo.write(PLACEHOLDERS);
    const passed = await clean.repo.script(GATE, clean.base, await clean.repo.commit("feat: placeholders"));
    expect(passed).toEqual({ exitCode: 0, text: "secrets: the range adds no secret\n" });
  },
  SCAN_MS,
);

test(
  "each link and key line fails on exactly the rules its row names, and a row naming none passes",
  async () => {
    const table = cases();
    const { repo, base } = await started();
    await repo.write(linesByFile(table));
    const found = rulesByPlace((await repo.script(GATE, base, await repo.commit("feat: plant cases"))).text);
    const expected = [...Map.groupBy(table, (row) => row.file).entries()].flatMap(([file, rows]) =>
      rows.map((row, index) => ({ place: `${file}:${index + 1}`, rules: row.rules.toSorted() })),
    );
    expect(expected.map(({ place }) => ({ place, rules: found.get(place) ?? [] }))).toEqual(expected);
  },
  SCAN_MS,
);

test(
  "a secret a later commit removes still fails, and one ref scans that commit alone",
  async () => {
    const { repo, base } = await started();
    await repo.write({ "vpn/wg0.conf": `PrivateKey = ${base64Key()}\n` });
    const added = await repo.commit("feat: add a key");
    await repo.write({ "vpn/wg0.conf": "PrivateKey = <private-key>\n" });
    const removed = await repo.commit("fix: drop the key");

    const range = await repo.script(GATE, base, removed);
    expect(range.exitCode).toBe(1);
    expect(range.text).toContain(`  vpn/wg0.conf:1 wireguard-key in ${added.slice(0, 8)}`);
    expect(await repo.script(GATE, removed)).toEqual({ exitCode: 0, text: "secrets: the range adds no secret\n" });
    expect((await repo.script(GATE, added)).exitCode).toBe(1);
  },
  SCAN_MS,
);

test(
  "a key written while resolving a merge fails under its own path, and a key the merge brings in from before the range passes",
  async () => {
    const resolved = await diverged({
      topic: { "vpn/wg0.conf": "topic\n", "b/wg0.conf": "topic\n", "b/peer.conf": "peer\n" },
      main: { "vpn/wg0.conf": "main\n", "b/wg0.conf": "main\n" },
    });
    await resolved.repo.write({
      "vpn/wg0.conf": `PrivateKey = ${base64Key()}\n`,
      "b/wg0.conf": `PrivateKey = ${base64Key()}\n`,
      "b/peer.conf": `PresharedKey = ${base64Key()}\n`,
    });
    const merge = await resolved.repo.commit("merge: main into topic");
    const inMerge = (place: string) => `  ${place} wireguard-key in ${merge.slice(0, 8)}: A WireGuard or AmneziaWG private or pre-shared key`;
    const failed = await resolved.repo.script(GATE, resolved.main, merge);
    expect(failed.exitCode).toBe(1);
    expect(failed.text.split("\n").slice(1, -1)).toEqual([inMerge("b/peer.conf:1"), inMerge("b/wg0.conf:1"), inMerge("vpn/wg0.conf:1")]);
    expect((await resolved.repo.script(GATE, merge)).text).toBe(failed.text);

    const inherited = await diverged({
      topic: { "README.md": "# topic\n" },
      main: { "README.md": "# main\n", "vpn/wg0.conf": `PrivateKey = ${base64Key()}\n` },
    });
    await inherited.repo.write({ "README.md": "# fixture\n" });
    const passed = await inherited.repo.script(GATE, inherited.main, await inherited.repo.commit("merge: main into topic"));
    expect(passed).toEqual({ exitCode: 0, text: "secrets: the range adds no secret\n" });
  },
  SCAN_MS,
);

test(
  "a git too old to diff a merge's resolution fails the gate rather than passing it",
  async () => {
    const { repo, base } = await started();
    await repo.write({ "vpn/wg0.conf": "PrivateKey = <private-key>\n" });
    const head = await repo.commit("feat: add a placeholder");
    const oldGit = await scratch("checks-secrets-git-");
    await writeFile(
      join(oldGit, "git"),
      `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = --remerge-diff ]; then echo "fatal: unrecognized argument: --remerge-diff" >&2; exit 128; fi\ndone\nexec ${Bun.which("git")} "$@"\n`,
      { mode: 0o755 },
    );
    const rejected = await ran(
      $`bun ${join(CHECKOUT, "src", GATE)} ${base} ${head}`.cwd(repo.dir).env({ ...process.env, PATH: `${oldGit}:${process.env["PATH"] ?? ""}` }),
    );
    expect(rejected.exitCode).toBe(2);
    expect(rejected.text).toContain("unrecognized argument: --remerge-diff");
  },
  SCAN_MS,
);

test(
  "a repository's own gitleaks config, ignore file and allow comment accept nothing",
  async () => {
    const { repo, base } = await started();
    await repo.write({
      ".gitleaks.toml": 'title = "lax"\n[[rules]]\nid = "nothing"\nregex = \'\'\'^never$\'\'\'\n',
      "vpn/wg0.conf": `PrivateKey = ${base64Key()} # gitleaks:allow\n`,
    });
    const head = await repo.commit("feat: try to accept a key");
    await repo.write({ ".gitleaksignore": `${head}:vpn/wg0.conf:wireguard-key:1\n` });
    const failed = await repo.script(GATE, base, head);
    expect(failed.exitCode).toBe(1);
    expect(failed.text).toContain(`  vpn/wg0.conf:1 wireguard-key in ${head.slice(0, 8)}`);
  },
  SCAN_MS,
);

test(
  "checks-lint runs the gate in every repository",
  async () => {
    const repo = await open(lintWiring());
    await repo.commit("chore: wire lint");
    await repo.write({ "vpn/links.txt": link("trojan", `${hex(12)}@${HOST}:443#home`) });
    await repo.commit("feat: add a link");
    const lint = await repo.lint();
    expect(lint.text).toContain("  vpn/links.txt:1 proxy-userinfo-link in ");
    expect(lint.text).toContain("checks-secrets");
  },
  SCAN_MS,
);
