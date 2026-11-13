import { Effect } from "effect";
import { gzip } from "node:zlib";
import type { Page } from "playwright-core";
import { fromAnotherOrigin } from "./assets.ts";
import type { WeightBudgets } from "./declaration.ts";
import { attempt, BrowserFailure } from "./page.ts";

export type PageWeight = {
  readonly nonImage: number;
  readonly script: number;
  readonly image: number;
  readonly responses: number;
};

type Received = {
  readonly body: Uint8Array;
  readonly image: boolean;
  readonly script: boolean;
};

type ReadFailure = {
  readonly failure: string;
};

type Weighed = {
  readonly bytes: number;
  readonly image: boolean;
  readonly script: boolean;
};

const gzipped = (body: Uint8Array): Effect.Effect<number, BrowserFailure> =>
  Effect.callback((resume) => {
    gzip(body, (error, zipped) => {
      if (error) resume(Effect.fail(new BrowserFailure({ message: `cannot weigh a response: ${error.message}` })));
      else resume(Effect.succeed(zipped.length));
    });
  });

const IMAGE_LIMIT_MS = 10_000;

const SCROLL_THROUGH = `(async () => {
  const step = Math.max(1, Math.floor(window.innerHeight / 2));
  let at = 0;
  while (at < document.body.scrollHeight) {
    window.scrollTo(0, at);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    at += step;
  }
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`;

const RENDERED_IMAGES = `Promise.race([
  Promise.all([...document.images].filter((image) => image.getClientRects().length > 0).map((image) => image.decode().catch(() => undefined))),
  new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ${IMAGE_LIMIT_MS})),
]).then(() => undefined)`;

const FONTS_READY = "document.fonts.ready.then(() => undefined)";

const TWO_FRAMES = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))";

export const weighPage = Effect.fn("weighPage")(function* (page: Page, url: string) {
  const origin = new URL(url).origin;
  const received: Promise<Received | ReadFailure>[] = [];
  page.on("response", (response) => {
    if (fromAnotherOrigin(origin, response.url())) return;
    const status = response.status();
    if (status >= 300 && status <= 399) return;
    const type = response.request().resourceType();
    received.push(
      response.body().then(
        (body) => ({ body, image: type === "image", script: type === "script" }),
        (cause) => ({ failure: cause instanceof Error ? cause.message : String(cause) }),
      ),
    );
  });
  yield* attempt(`cannot load ${url}`, () => page.goto(url, { waitUntil: "networkidle" }));
  yield* attempt(`cannot scroll ${url} to its end`, () => page.evaluate(SCROLL_THROUGH));
  yield* attempt(`images never render on ${url}`, () => page.evaluate(RENDERED_IMAGES));
  yield* attempt(`fonts never settle on ${url}`, () => page.evaluate(FONTS_READY));
  yield* attempt(`cannot settle a frame on ${url}`, () => page.evaluate(TWO_FRAMES));
  yield* attempt(`cannot settle ${url} to network idle`, () => page.waitForLoadState("networkidle"));
  const bodies = yield* attempt(`cannot read the responses ${url} serves`, () => Promise.all(received));
  for (const entry of bodies) {
    if ("failure" in entry) return yield* Effect.fail(new BrowserFailure({ message: `cannot read the responses ${url} serves: ${entry.failure}` }));
  }
  const readable = bodies.filter((entry): entry is Received => !("failure" in entry));
  const responses = yield* Effect.forEach(readable, ({ body, image, script }): Effect.Effect<Weighed, BrowserFailure> =>
    image
      ? Effect.succeed({ bytes: body.length, image, script })
      : Effect.map(gzipped(body), (bytes) => ({ bytes, image, script })),
  );
  return {
    nonImage: responses.filter((response) => !response.image).reduce((sum, response) => sum + response.bytes, 0),
    script: responses.filter((response) => response.script).reduce((sum, response) => sum + response.bytes, 0),
    image: responses.filter((response) => response.image).reduce((sum, response) => sum + response.bytes, 0),
    responses: responses.length,
  } satisfies PageWeight;
});

export function judgePageWeight(budgets: WeightBudgets, weight: PageWeight): readonly string[] {
  if (weight.responses === 0) return ["weighed no response the page serves from its own origin"];
  const found: string[] = [];
  if (weight.nonImage > budgets.nonImageBytes) {
    found.push(`${weight.nonImage} bytes besides images over ${budgets.nonImageBytes} (over by ${weight.nonImage - budgets.nonImageBytes})`);
  }
  if (weight.script > budgets.scriptBytes) {
    found.push(`${weight.script} bytes of scripts over ${budgets.scriptBytes} (over by ${weight.script - budgets.scriptBytes})`);
  }
  if (weight.image > budgets.imageBytes) {
    found.push(`${weight.image} bytes of images over ${budgets.imageBytes} (over by ${weight.image - budgets.imageBytes})`);
  }
  return found;
}
