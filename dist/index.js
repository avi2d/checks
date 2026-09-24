// effect-channel/no-error-channel-escape.ts
var EFFECT_SOURCES = new Set(["effect", "effect/Effect"]);
var INSTEAD = {
  drops: "it drops the failure and the success together, so no caller can tell one from the other. Handle the error by tag, or keep it as a value with Effect.result or Effect.exit",
  swallows: "a Cause is the typed error plus defects plus interruption, so this swallows the bugs and the cancellations along with it. Catch the errors you named, with Effect.catchTag or Effect.catchTags",
  blind: "the handler cannot see what it is recovering from, so every error in the channel collapses into one fallback. Name the errors with Effect.catchTag, or take the error and use it"
};
var REFUSED = new Map([
  ["ignore", INSTEAD.drops],
  ["ignoreCause", INSTEAD.drops],
  ["catchCause", INSTEAD.swallows],
  ["catchCauseIf", INSTEAD.swallows],
  ["catchCauseFilter", INSTEAD.swallows]
]);
var blindToTheError = (handler) => {
  if (!handler)
    return false;
  if (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression")
    return false;
  return handler.params.every((param) => param.type === "Identifier" && /^_+$/.test(param.name));
};
var rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow the combinators that erase Effect's error channel" }
  },
  create(context) {
    const effect = new Set;
    const named = (node) => {
      if (!node || node.type !== "MemberExpression" || node.computed)
        return null;
      if (node.object.type !== "Identifier" || !effect.has(node.object.name))
        return null;
      return node.property.type === "Identifier" ? node.property.name : null;
    };
    const refuse = (node, combinator, instead) => {
      context.report({ node, message: `Effect.${combinator} erases the error channel: ${instead}` });
    };
    return {
      ImportDeclaration(node) {
        if (!EFFECT_SOURCES.has(node.source.value))
          return;
        const module = node.source.value === "effect/Effect";
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            if (specifier.imported.type === "Identifier" && specifier.imported.name === "Effect")
              effect.add(specifier.local.name);
          } else if (module)
            effect.add(specifier.local.name);
        }
      },
      MemberExpression(node) {
        const combinator = named(node);
        if (combinator === null)
          return;
        const instead = REFUSED.get(combinator);
        if (instead !== undefined)
          refuse(node, combinator, instead);
      },
      CallExpression(node) {
        if (named(node.callee) !== "catch")
          return;
        if (!blindToTheError(node.arguments[node.arguments.length - 1]))
          return;
        refuse(node, "catch", INSTEAD.blind);
      }
    };
  }
};
var no_error_channel_escape_default = rule;

// effect-channel/no-throw.ts
var rule2 = {
  meta: {
    type: "problem",
    docs: { description: "Disallow throw, which fails outside Effect's error channel" }
  },
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({
          node,
          message: "throw escapes the error channel: no type records the failure, so no caller has to answer for it. Define the failure with Schema.TaggedError and fail with it through Effect.fail, so it stays in E for Effect.catchTag to handle"
        });
      }
    };
  }
};
var no_throw_default = rule2;

// effect-channel/no-try-catch.ts
var rule3 = {
  meta: {
    type: "problem",
    docs: { description: "Disallow a try statement with a catch clause, which recovers outside Effect's error channel" }
  },
  create(context) {
    return {
      CatchClause(node) {
        context.report({
          node,
          message: "catch recovers outside the error channel: it takes whatever was thrown as unknown, bugs included. Wrap the throwing call in Effect.try or Effect.tryPromise, whose catch maps the cause to a Schema.TaggedError, and recover by tag with Effect.catchTag"
        });
      }
    };
  }
};
var no_try_catch_default = rule3;

// effect-channel/index.ts
var plugin = {
  meta: { name: "effect-channel" },
  rules: {
    "no-error-channel-escape": no_error_channel_escape_default,
    "no-throw": no_throw_default,
    "no-try-catch": no_try_catch_default
  }
};
var effect_channel_default = plugin;
export {
  effect_channel_default as default
};
