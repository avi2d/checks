import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { fixtureRepos, lintWiring, type FixtureRepo } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-secrets-");
const GATE = "delivery/secrets.ts";
const SCAN_MS = 120_000;

// Each secret is assembled at run time, so the kit's own scan finds none in this file.
const base64Key = () => randomBytes(32).toString("base64");
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const alphanumeric = (length: number) => randomBytes(length * 2).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, length);
const link = (scheme: string, rest: string) => `${scheme}://${rest}`;
const armor = (edge: string) => `-----${edge} OPENSSH PRIVATE KEY-----`;
const HOST = "vpn.home-fixture.net";

function planted(): Readonly<Record<string, string>> {
  const vmess = Buffer.from(JSON.stringify({ v: "2", add: HOST, port: "443", id: randomUUID(), net: "ws" })).toString("base64");
  const shadowsocks = Buffer.from(`chacha20-ietf-poly1305:${hex(12)}`).toString("base64");
  return {
    "vpn/wg0.conf": `[Interface]\nPrivateKey = ${base64Key()}\n\n[Peer]\nPublicKey = ${base64Key()}\nPresharedKey = ${base64Key()}\n`,
    "vpn/awg0.json": JSON.stringify({ privateKey: base64Key(), jc: 4 }),
    "vpn/links.txt": [
      link("vless", `${randomUUID()}@${HOST}:443?security=reality#home`),
      link("vmess", vmess),
      link("ss", `${shadowsocks}@${HOST}:8388#home`),
      link("trojan", `${hex(12)}@${HOST}:443#home`),
      link("https", `panel.home-fixture.net/sub/${hex(16)}`),
    ].join("\n"),
    "deploy/key": `${armor("BEGIN")}\n${randomBytes(300).toString("base64")}\n${armor("END")}\n`,
    ".env": `GITHUB_TOKEN=${["gh", "p_"].join("")}${alphanumeric(36)}\n`,
  };
}

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  "vpn/wg0.conf": "[Interface]\nPrivateKey = <private-key>\n\n[Peer]\nPublicKey = <server-public-key>\nPresharedKey = ${WG_PRESHARED_KEY}\n",
  "vpn/awg0.json": JSON.stringify({ privateKey: "<private-key>", jc: 4 }),
  "vpn/links.txt": [
    link("vless", "<uuid>@vpn.example.com:443?security=reality#home"),
    link("vmess", "<base64-config>"),
    link("trojan", `${randomUUID()}@vpn.example.com:443#home`),
    link("https", "panel.example.com/sub/0123456789abcdef0123456789abcdef"),
  ].join("\n"),
  "deploy/key": "<ssh-private-key>\n",
  ".env": "GITHUB_TOKEN=<github-token>\n",
};

async function started(): Promise<{ readonly repo: FixtureRepo; readonly base: string }> {
  const repo = await open({ "README.md": "# fixture\n" });
  return { repo, base: await repo.commit("chore: start") };
}

test(
  "a range adding a real secret of each kind fails on each, and the same files with placeholders pass",
  async () => {
    const { repo, base } = await started();
    await repo.write(planted());
    const head = await repo.commit("feat: plant secrets");
    const failed = await repo.script(GATE, base, head);
    expect(failed.exitCode).toBe(1);
    expect(failed.text).toContain("secrets: the range adds 10 secret(s)");
    for (const place of [
      "vpn/wg0.conf:2 wireguard-key",
      "vpn/wg0.conf:6 wireguard-key",
      "vpn/awg0.json:1 wireguard-key",
      "vpn/links.txt:1 proxy-share-link",
      "vpn/links.txt:2 proxy-share-link",
      "vpn/links.txt:3 proxy-share-link",
      "vpn/links.txt:4 proxy-share-link",
      "vpn/links.txt:5 proxy-subscription-url",
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
    expect(lint.text).toContain("  vpn/links.txt:1 proxy-share-link in ");
    expect(lint.text).toContain("checks-secrets");
  },
  SCAN_MS,
);
