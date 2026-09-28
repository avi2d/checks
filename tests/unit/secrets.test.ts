import { expect, test } from "bun:test";
import { Option } from "effect";
import { gitleaksBuildFor, type Leak } from "../../src/delivery/gitleaks.ts";
import { report } from "../../src/delivery/secrets.ts";

const leak = (File: string, StartLine: number, RuleID: string, Commit = "e19e45c2f00dfeed", StartColumn = 1): Leak => ({
  File,
  StartLine,
  StartColumn,
  RuleID,
  Commit,
  Description: `the ${RuleID} rule`,
});

test("each platform a runner or a laptop uses has a pinned gitleaks archive, and any other has none", () => {
  expect(Option.map(gitleaksBuildFor("linux", "x64"), ({ archive }) => archive)).toEqual(Option.some("gitleaks_8.30.1_linux_x64.tar.gz"));
  expect(Option.map(gitleaksBuildFor("darwin", "arm64"), ({ archive }) => archive)).toEqual(Option.some("gitleaks_8.30.1_darwin_arm64.tar.gz"));
  expect(Option.getOrUndefined(gitleaksBuildFor("linux", "arm64"))?.binarySha256).toMatch(/^[0-9a-f]{64}$/);
  expect(gitleaksBuildFor("win32", "x64")).toEqual(Option.none());
});

test("the report names each secret by file, line and rule in that order, and the commit that added it", () => {
  expect(report([])).toBe("secrets: the range adds no secret");
  expect(report([leak("vpn/wg0.conf", 7, "wireguard-key"), leak(".env", 1, "github-pat"), leak("vpn/wg0.conf", 2, "wireguard-key")]).split("\n")).toEqual([
    "secrets: the range adds 3 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:",
    "  .env:1 github-pat in e19e45c2: the github-pat rule",
    "  vpn/wg0.conf:2 wireguard-key in e19e45c2: the wireguard-key rule",
    "  vpn/wg0.conf:7 wireguard-key in e19e45c2: the wireguard-key rule",
  ]);
});

test("the report counts a secret gitleaks matches twice on one line, once as written and once decoded, as one", () => {
  const twice = leak("vpn/links.txt", 3, "proxy-userinfo-link");
  expect(report([twice, twice, leak("vpn/links.txt", 3, "proxy-userinfo-link", "a0b1c2d3e4f5a6b7")]).split("\n")).toEqual([
    "secrets: the range adds 2 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:",
    "  vpn/links.txt:3 proxy-userinfo-link in a0b1c2d3: the proxy-userinfo-link rule",
    "  vpn/links.txt:3 proxy-userinfo-link in e19e45c2: the proxy-userinfo-link rule",
  ]);
});

test("the report counts two secrets one rule finds at different columns of one line as two", () => {
  const first = leak("vpn/links.txt", 3, "proxy-userinfo-link", "e19e45c2f00dfeed", 1);
  const second = leak("vpn/links.txt", 3, "proxy-userinfo-link", "e19e45c2f00dfeed", 46);
  expect(report([first, second]).split("\n")).toEqual([
    "secrets: the range adds 2 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:",
    "  vpn/links.txt:3 proxy-userinfo-link in e19e45c2: the proxy-userinfo-link rule",
    "  vpn/links.txt:3 proxy-userinfo-link in e19e45c2: the proxy-userinfo-link rule",
  ]);
});
