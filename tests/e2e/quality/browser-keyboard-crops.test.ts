import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page } from "../lib/browser-site.ts";

test("keyboard keeps a visible focus ring and rejects a missing ring on a tall page", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<a id="visible" href="/">Visible</a><a id="missing" href="/">Missing</a><div style="height: 4000px"></div>`,
      { head: `<style>#visible:focus { outline: 3px solid black; } #missing:focus { outline: none; }</style>
        <script>
          const decodeImage = window.createImageBitmap.bind(window);
          window.createImageBitmap = async (blob) => {
            const image = await decodeImage(blob);
            if (image.width > 160 || image.height > 160) throw new Error("image exceeds the focus region");
            return image;
          };
        </script>` },
    ),
    "checks.config.ts": declaration({
      targets: [
        { name: "visible", selector: "#visible", focusable: true },
        { name: "missing", selector: "#missing", focusable: true },
      ],
      checks: ["keyboard"],
    }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} missing shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);
