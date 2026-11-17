import { Effect } from "effect";
import { BrowserRoutes, decodeSetting, loadSettings } from "../../core/settings.ts";
import type { Declaration } from "./declaration.ts";

export const reachedRoutes = Effect.fn("reachedRoutes")(function* (root: string, changed: readonly string[], declaration: Declaration) {
  if (changed.length === 0) return undefined;
  const raw = (yield* loadSettings(root))["browserRoutes"];
  if (raw === undefined) return undefined;
  const map = yield* decodeSetting("browserRoutes", BrowserRoutes, raw);
  const declared = new Set(declaration.routes.map(({ path }) => path));
  const routes = changed.flatMap((path) => map[path] ?? []);
  if (changed.some((path) => map[path] === undefined) || routes.some((path) => !declared.has(path))) return undefined;
  return new Set(routes);
});
