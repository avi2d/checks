import type { Page } from "playwright-core";

const FAILING_STATUS = 400;

export type AssetWatch = {
  readonly requested: () => number;
  readonly found: () => readonly string[];
};

// A data: or about: address has an opaque origin, which the URL standard serialises as "null" and which carries no other site's content.
export function fromAnotherOrigin(pageOrigin: string, url: string): boolean {
  const { origin } = new URL(url);
  return origin !== "null" && origin !== pageOrigin;
}

export function watchAssets(page: Page, pageOrigin: string): AssetWatch {
  const found: string[] = [];
  let requested = 0;
  page.on("request", (request) => {
    requested += 1;
    if (fromAnotherOrigin(pageOrigin, request.url())) found.push(`requests another origin: ${request.url()}`);
  });
  page.on("requestfailed", (request) => {
    found.push(`${request.url()} fails to load: ${request.failure()?.errorText ?? "no reason given"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= FAILING_STATUS) found.push(`${response.url()} answers ${response.status()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") found.push(`logs the error: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    found.push(`throws an uncaught ${error.name}: ${error.message}`);
  });
  return { requested: () => requested, found: () => [...found] };
}
