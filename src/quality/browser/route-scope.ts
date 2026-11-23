import { Effect } from "effect";
import { BrowserRoutes, decodeSetting, loadSettings } from "../../core/settings.ts";
import type { Declaration } from "./declaration.ts";

export const reachedRoutes = Effect.fn("reachedRoutes")(function* (root: string, changed: readonly string[], declaration: Declaration) {
  if (changed.length === 0) return { kind: "full", because: "the pull request changes no file" } as const;
  const raw = (yield* loadSettings(root))["browserRoutes"];
  if (raw === undefined) return { kind: "full", because: "browserRoutes is not configured" } as const;
  const map = yield* decodeSetting("browserRoutes", BrowserRoutes, raw);
  const unmapped = changed.find((path) => !Object.hasOwn(map, path));
  if (unmapped !== undefined) return { kind: "full", because: `${unmapped} has no browserRoutes mapping` } as const;
  const declared = new Set(declaration.routes.map(({ path }) => path));
  const routes = changed.flatMap((path) => map[path] ?? []);
  const unknown = routes.find((path) => !declared.has(path));
  if (unknown !== undefined) return { kind: "full", because: `browserRoutes names undeclared route ${unknown}` } as const;
  return { kind: "routes", routes: new Set(routes) } as const;
});
