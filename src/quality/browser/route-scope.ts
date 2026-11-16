import { Effect } from "effect";
import { BrowserRoutes, decodeSetting, loadSettings } from "../../core/settings.ts";
import type { Declaration } from "./declaration.ts";

const SHARED_NAME = /(?:^|[./_-])(?:layout|style|styles|font|fonts|config|lock)(?:[./_-]|$)/i;
const SHARED_EXTENSION = /\.(?:css|scss|sass|less|woff2?|ttf|otf)$/i;

function shared(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return SHARED_NAME.test(path) || SHARED_EXTENSION.test(path) || /(?:config|rc)(?:\.[^.]+)?$/i.test(name) || name === "package.json" || name.startsWith(".env") || path.startsWith(".github/") || path.startsWith("public/");
}

export const reachedRoutes = Effect.fn("reachedRoutes")(function* (root: string, changed: readonly string[], declaration: Declaration) {
  if (changed.length === 0 || changed.some(shared)) return undefined;
  const raw = (yield* loadSettings(root))["browserRoutes"];
  if (raw === undefined) return undefined;
  const map = yield* decodeSetting("browserRoutes", BrowserRoutes, raw);
  const declared = new Set(declaration.routes.map(({ path }) => path));
  const routes = changed.flatMap((path) => map[path] ?? []);
  if (changed.some((path) => map[path] === undefined) || routes.some((path) => !declared.has(path))) return undefined;
  return new Set(routes);
});
