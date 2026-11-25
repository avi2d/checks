import { expect, test } from "bun:test";
import { Effect } from "effect";
import { awaitStagedVersion, stagedShasum } from "../../../src/delivery/staged-publish.ts";

const shasum = "df443a432e0632f91433878d7a807a91df42d6a8";
const staged = `npm notice shasum: ${shasum}\nnpm error code E409\nnpm error 409 Conflict - Cannot publish over previously staged version "0.23.0".\n`;

test("a staged E409 reads the shasum instead of accepting another version", () => {
  expect(stagedShasum(staged, "0.23.0")).toBe(shasum);
  expect(stagedShasum(staged, "0.23.1")).toBeUndefined();
  expect(stagedShasum(staged.replace("E409", "E403"), "0.23.0")).toBeUndefined();
});

const published = `npm notice shasum: ${shasum}\nnpm error code E403\nnpm error You cannot publish over the previously published versions: 0.23.0.\n`;

test("a published E403 reads the shasum instead of rejecting a same-version race", () => {
  expect(stagedShasum(published, "0.23.0")).toBe(shasum);
});

test("a published E403 rejects other versions and unrelated authorization errors", () => {
  expect(stagedShasum(published, "0.23.1")).toBeUndefined();
  expect(stagedShasum(published.replace("0.23.0.", "0.23.0-beta.1."), "0.23.0")).toBeUndefined();
  expect(stagedShasum(published.replace("E403", "E409"), "0.23.0")).toBeUndefined();
  expect(stagedShasum(`npm notice shasum: ${shasum}\nnpm error code E403\nnpm error permission denied`, "0.23.0")).toBeUndefined();
});

test("a duplicate refusal without a tarball shasum cannot claim a matching upload", () => {
  expect(stagedShasum(staged.replace(`npm notice shasum: ${shasum}\n`, ""), "0.23.0")).toBeUndefined();
  expect(stagedShasum(published.replace(`npm notice shasum: ${shasum}\n`, ""), "0.23.0")).toBeUndefined();
});

test("a staged version that appears with the same shasum succeeds instead of failing immediately", async () => {
  const answers = [undefined, shasum];
  let calls = 0;
  const result = await Effect.runPromise(awaitStagedVersion(shasum, () => Effect.sync(() => answers[calls++]), () => Effect.void, 3));
  expect(result).toBe(true);
  expect(calls).toBe(2);
});

test("a staged version with a different shasum fails instead of accepting a different tarball", async () => {
  const result = await Effect.runPromise(awaitStagedVersion(shasum, () => Effect.succeed("0000000000000000000000000000000000000000"), () => Effect.void, 3));
  expect(result).toBe(false);
});

test("a staged version that never appears fails after the bounded attempts", async () => {
  let calls = 0;
  const result = await Effect.runPromise(awaitStagedVersion(shasum, () => Effect.sync(() => { calls += 1; return undefined; }), () => Effect.void, 3));
  expect(result).toBe(false);
  expect(calls).toBe(3);
});
