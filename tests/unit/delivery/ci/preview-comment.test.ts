import { expect, test } from "bun:test";
import { previewBody } from "../../../../src/delivery/ci/preview-comment.ts";

test("a preview link without its trailing slash, or naming the full commit, fails", () => {
  expect(previewBody("0123456789abcdef0123456789abcdef01234567", "https://feature.site.pages.dev")).toBe(
    "Preview of `0123456`: https://feature.site.pages.dev/",
  );
});
