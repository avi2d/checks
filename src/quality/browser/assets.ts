import type { Page } from "playwright-core";

const FAILING_STATUS = 400;

export type AssetWatch = {
  readonly requested: () => number;
  readonly found: () => readonly string[];
};

export function watchAssets(page: Page): AssetWatch {
  const found: string[] = [];
  let requested = 0;
  page.on("request", () => {
    requested += 1;
  });
  page.on("requestfailed", (request) => {
    found.push(`${request.url()} fails to load: ${request.failure()?.errorText ?? "no reason given"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= FAILING_STATUS) found.push(`${response.url()} answers ${response.status()}`);
  });
  return { requested: () => requested, found: () => [...found] };
}
