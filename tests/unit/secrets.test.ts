import { expect, test } from "bun:test";
import { Option } from "effect";
import { gitleaksBuildFor, type Leak } from "../../src/delivery/gitleaks.ts";
import { report } from "../../src/delivery/secrets.ts";

const leak = (File: string, StartLine: number, RuleID: string, Commit = "e19e45c2f00dfeed"): Leak => ({
  File,
  StartLine,
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
  expect(report([], [])).toBe("secrets: the range adds no secret");
  expect(report([leak("vpn/wg0.conf", 7, "wireguard-key"), leak(".env", 1, "github-pat"), leak("vpn/wg0.conf", 2, "wireguard-key")], []).split("\n")).toEqual([
    "secrets: the range adds 3 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:",
    "  .env:1 github-pat in e19e45c2: the github-pat rule",
    "  vpn/wg0.conf:2 wireguard-key in e19e45c2: the wireguard-key rule",
    "  vpn/wg0.conf:7 wireguard-key in e19e45c2: the wireguard-key rule",
  ]);
});

test("a finding in a commit message counts toward the total and names the message and its commit rather than the scratch file it was scanned from", () => {
  const files = [leak("notes.md", 4, "private-host")];
  const messages = [leak("/tmp/scan/b07c0ffee1", 3, "private-name", "b07c0ffee1"), leak("/tmp/scan/a11ce5ab1e", 1, "private-domain", "a11ce5ab1e")];
  expect(report(files, messages).split("\n")).toEqual([
    "secrets: the range adds 3 secret(s); put a placeholder such as <private-key> in its place in the commit that added it, and rotate any secret that left this machine:",
    "  notes.md:4 private-host in e19e45c2: the private-host rule",
    "  the message:1 private-domain in a11ce5ab: the private-domain rule",
    "  the message:3 private-name in b07c0ffe: the private-name rule",
  ]);
  expect(report([], messages)).not.toContain("/tmp/scan");
});

