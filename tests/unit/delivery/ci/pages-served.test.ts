import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { addressOf, freshAddress, originOf, sameBytes, servedPaths } from "../../../../src/delivery/ci/pages-served.ts";

describe("addressOf", () => {
  test("a folder index asked for by its file name in place of the folder address the hosts serve it at fails", () => {
    expect(addressOf("index.html")).toBe("/");
    expect(addressOf("about/index.html")).toBe("/about/");
    expect(addressOf("styles/site.css")).toBe("/styles/site.css");
  });
});

describe("servedPaths", () => {
  test("a host config file such as _headers or CNAME, which no host serves as a page, that is checked fails", () => {
    expect(servedPaths(["robots.txt", "_headers", "CNAME", "index.html", "_redirects", ".nojekyll", "about/_headers"])).toEqual([
      "about/_headers",
      "index.html",
      "robots.txt",
    ]);
  });
});

describe("sameBytes", () => {
  test("a served file one byte off or one byte short that reads as built fails", () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe("freshAddress", () => {
  test("an address that leaves a space or a hash unescaped, or asks twice with the same query, fails", () => {
    const first = freshAddress("https://azalialaw.pages.dev", "news/a b#1.html", 1);
    expect(first).toStartWith("https://azalialaw.pages.dev/news/a%20b%231.html?served-check=1-");
    expect(freshAddress("https://azalialaw.pages.dev", "index.html", 2)).not.toBe(freshAddress("https://azalialaw.pages.dev", "index.html", 3));
  });
});

describe("originOf", () => {
  test("a plain http origin that passes, or an https origin whose path is kept, fails", () => {
    expect(Exit.isFailure(Effect.runSyncExit(originOf("http://azalialaw.com")))).toBe(true);
    expect(Effect.runSync(originOf("https://azalialaw.com/"))).toBe("https://azalialaw.com");
  });
});
