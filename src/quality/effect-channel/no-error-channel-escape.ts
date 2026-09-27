import type { CreateRule, ESTree } from "@oxlint/plugins";

const EFFECT_SOURCES = new Set(["effect", "effect/Effect"]);

const INSTEAD = {
  drops:
    "it drops the failure and the success together, so no caller can tell one from the other. Handle the error by tag, or keep it as a value with Effect.result or Effect.exit",
  swallows:
    "a Cause is the typed error plus defects plus interruption, so this swallows the bugs and the cancellations along with it. Catch the errors you named, with Effect.catchTag or Effect.catchTags",
  blind:
    "the handler cannot see what it is recovering from, so every error in the channel collapses into one fallback. Name the errors with Effect.catchTag, or take the error and use it",
} as const;

const REFUSED = new Map<string, string>([
  ["ignore", INSTEAD.drops],
  ["ignoreCause", INSTEAD.drops],
  ["catchCause", INSTEAD.swallows],
  ["catchCauseIf", INSTEAD.swallows],
  ["catchCauseFilter", INSTEAD.swallows],
]);

const blindToTheError = (handler: ESTree.Node | undefined): boolean => {
  if (!handler) return false;
  if (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression") return false;
  return handler.params.every((param) => param.type === "Identifier" && /^_+$/.test(param.name));
};

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow the combinators that erase Effect's error channel" },
  },
  create(context) {
    // The local names bound to the Effect module, so an unrelated object's own `.ignore` is left alone.
    const effect = new Set<string>();

    const named = (node: ESTree.Node | undefined): string | null => {
      if (!node || node.type !== "MemberExpression" || node.computed) return null;
      if (node.object.type !== "Identifier" || !effect.has(node.object.name)) return null;
      return node.property.type === "Identifier" ? node.property.name : null;
    };

    const refuse = (node: ESTree.Node, combinator: string, instead: string): void => {
      context.report({ node, message: `Effect.${combinator} erases the error channel: ${instead}` });
    };

    return {
      ImportDeclaration(node) {
        if (!EFFECT_SOURCES.has(node.source.value)) return;
        const module = node.source.value === "effect/Effect";
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            if (specifier.imported.type === "Identifier" && specifier.imported.name === "Effect") effect.add(specifier.local.name);
          } else if (module) effect.add(specifier.local.name);
        }
      },

      MemberExpression(node) {
        const combinator = named(node);
        if (combinator === null) return;
        const instead = REFUSED.get(combinator);
        if (instead !== undefined) refuse(node, combinator, instead);
      },

      CallExpression(node) {
        if (named(node.callee) !== "catch") return;
        // The handler is last in both forms: Effect.catch(handler) in a pipe, Effect.catch(effect, handler) data-first.
        if (!blindToTheError(node.arguments[node.arguments.length - 1])) return;
        refuse(node, "catch", INSTEAD.blind);
      },
    };
  },
};

export default rule;
