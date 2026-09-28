import { expect, test } from "bun:test";
import { taggedCommitOf } from "../../src/delivery/release-tag.ts";

const TAG_OBJECT = "c".repeat(40);
const COMMIT = "d".repeat(40);

test("a lightweight tag names its commit, and an annotated one the commit on its peeled line", () => {
  expect(taggedCommitOf(`${COMMIT}\trefs/tags/v0.2.0\n`)).toBe(COMMIT);
  expect(taggedCommitOf(`${TAG_OBJECT}\trefs/tags/v0.2.0\n${COMMIT}\trefs/tags/v0.2.0^{}\n`)).toBe(COMMIT);
  expect(taggedCommitOf("")).toBeUndefined();
});
