import { expect, test } from "bun:test";
import { removedBody } from "../../../../src/delivery/ci/preview-remove.ts";

test("a removal note without the deleted count fails", () => {
  expect(removedBody(3)).toBe("Preview removed: the pull request closed and its 3 deployment(s) on Cloudflare Pages were deleted.");
});
