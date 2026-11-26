// src/quality/effect-channel/no-error-channel-escape.ts
var EFFECT_BARREL = "effect";
var EFFECT_MODULE = "effect/Effect";
var DIAGNOSTIC = {
  drops: "erases the error channel: it drops the failure and the success together, so no caller can tell one from the other. Handle the error by tag, or keep it as a value with Effect.result or Effect.exit",
  swallows: "erases the error channel: a Cause is the typed error plus defects plus interruption, so this swallows the bugs and the cancellations along with it. Catch the errors you named, with Effect.catchTag or Effect.catchTags",
  filtered: "can recover from a Cause that includes defects or interruptions. A non-match still fails. To handle only typed errors, use Effect.catchIf or Effect.catchFilter",
  blind: "erases the error channel: the handler cannot see what it is recovering from, so every error in the channel collapses into one fallback. Name the errors with Effect.catchTag, or take the error and use it"
};
var REFUSED = new Map([
  ["ignore", DIAGNOSTIC.drops],
  ["ignoreCause", DIAGNOSTIC.drops],
  ["catchCause", DIAGNOSTIC.swallows],
  ["catchCauseIf", DIAGNOSTIC.filtered],
  ["catchCauseFilter", DIAGNOSTIC.filtered]
]);
var BLIND_RECOVERY = new Set(["catch", "catchEager", "orElseSucceed"]);
function propertyName(node) {
  const property = node.type === "MemberExpression" ? node.property : node.key;
  if (!node.computed && property.type === "Identifier")
    return property.name;
  if (property.type === "Literal" && typeof property.value === "string")
    return property.value;
  if (property.type === "TemplateLiteral" && property.expressions.length === 0)
    return property.quasis[0]?.value.cooked ?? undefined;
  return;
}
function effectBinding(source, specifier) {
  if (specifier.type !== "ImportSpecifier")
    return source === EFFECT_MODULE ? { kind: "module" } : undefined;
  if (specifier.importKind === "type")
    return;
  const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
  if (source === EFFECT_BARREL)
    return name === "Effect" ? { kind: "module" } : undefined;
  if (BLIND_RECOVERY.has(name) || REFUSED.has(name))
    return { kind: "combinator", name };
  return;
}
var rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow the combinators that erase Effect's error channel" }
  },
  create(context) {
    function blindToTheError(handler) {
      if (!handler || handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression")
        return false;
      const [parameter] = handler.params;
      if (!parameter)
        return true;
      if (parameter.type !== "Identifier")
        return false;
      const variable = context.sourceCode.getDeclaredVariables(handler).find((binding) => binding.identifiers.some((identifier) => identifier.start === parameter.start));
      return variable !== undefined && !variable.references.some((reference) => reference.isRead());
    }
    function checkReference(node, combinator) {
      const call = node.parent;
      const blindRecovery = BLIND_RECOVERY.has(combinator) && call?.type === "CallExpression" && call.callee === node && blindToTheError(call.arguments.at(-1));
      const diagnostic = blindRecovery ? DIAGNOSTIC.blind : REFUSED.get(combinator);
      if (diagnostic !== undefined) {
        context.report({ node: blindRecovery ? call : node, message: `Effect.${combinator} ${diagnostic}` });
      }
    }
    function checkModuleReference(identifier) {
      const parent = identifier.parent;
      if (parent?.type === "MemberExpression" && parent.object === identifier) {
        const combinator = propertyName(parent);
        if (combinator !== undefined)
          checkReference(parent, combinator);
        return;
      }
      if (parent?.type === "VariableDeclarator" && parent.init === identifier && parent.parent.type === "VariableDeclaration" && parent.parent.kind === "const") {
        checkModuleBinding(parent);
      }
    }
    function checkModuleBinding(declarator) {
      if (declarator.id.type === "Identifier") {
        checkBinding(declarator, declarator.id, { kind: "module" });
        return;
      }
      if (declarator.id.type !== "ObjectPattern")
        return;
      for (const property of declarator.id.properties) {
        if (property.type !== "Property" || property.value.type !== "Identifier")
          continue;
        const name = propertyName(property);
        if (name !== undefined && (REFUSED.has(name) || BLIND_RECOVERY.has(name))) {
          checkBinding(declarator, property.value, { kind: "combinator", name });
        }
      }
    }
    function checkBinding(declaration, identifier, binding) {
      for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
        if (variable.name !== identifier.name)
          continue;
        for (const reference of variable.references) {
          if (!reference.isRead() || reference.identifier.parent.type === "TSTypeQuery" || reference.identifier.parent.type === "TSQualifiedName")
            continue;
          if (binding.kind === "module")
            checkModuleReference(reference.identifier);
          else
            checkReference(reference.identifier, binding.name);
        }
      }
    }
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (node.importKind === "type" || source !== EFFECT_BARREL && source !== EFFECT_MODULE)
          return;
        for (const specifier of node.specifiers) {
          const binding = effectBinding(source, specifier);
          if (binding !== undefined)
            checkBinding(specifier, specifier.local, binding);
        }
      }
    };
  }
};
var no_error_channel_escape_default = rule;

// src/quality/effect-channel/no-throw.ts
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

// src/quality/effect-channel/no-try-catch.ts
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

// src/quality/effect-channel/index.ts
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
