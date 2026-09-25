// effect-channel/cognitive-nodes.ts
var CONTROL_TYPES = ["IfStatement", "ConditionalExpression", "SwitchStatement", "SwitchCase", "TryStatement", "CatchClause"];
var LOOP_TYPES = ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement", "LabeledStatement"];
var CALL_TYPES = ["LogicalExpression", "BreakStatement", "ContinueStatement", "CallExpression", "NewExpression", "ImportExpression"];
var FUNCTION_TYPES = ["FunctionDeclaration", "FunctionExpression", "TSDeclareFunction", "TSEmptyBodyFunctionExpression", "ArrowFunctionExpression", "StaticBlock"];
var PLAIN_A_TYPES = ["BlockStatement", "ExpressionStatement", "ReturnStatement", "ThrowStatement", "VariableDeclaration", "VariableDeclarator", "AssignmentPattern", "ObjectPattern", "ArrayPattern", "Property", "RestElement", "TSParameterProperty", "WithStatement", "TSEnumDeclaration", "TSEnumBody", "TSEnumMember"];
var PLAIN_B_TYPES = ["ClassDeclaration", "ClassExpression", "ClassBody", "MethodDefinition", "TSAbstractMethodDefinition", "PropertyDefinition", "TSAbstractPropertyDefinition", "AccessorProperty", "TSAbstractAccessorProperty", "ObjectExpression", "ArrayExpression"];
var PLAIN_C_TYPES = ["AwaitExpression", "UnaryExpression", "UpdateExpression", "SpreadElement", "YieldExpression", "BinaryExpression", "AssignmentExpression", "TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "ChainExpression", "ParenthesizedExpression", "Decorator", "TSInstantiationExpression", "MemberExpression", "JSXMemberExpression", "TemplateLiteral", "TaggedTemplateExpression", "SequenceExpression", "JSXElement", "JSXFragment", "JSXOpeningElement", "JSXAttribute", "JSXExpressionContainer", "JSXSpreadChild", "JSXSpreadAttribute"];

// effect-channel/cognitive-plain.ts
function isControl(node) {
  return CONTROL_TYPES.includes(node.type);
}
function isLoop(node) {
  return LOOP_TYPES.includes(node.type);
}
function isCall(node) {
  return CALL_TYPES.includes(node.type);
}
function isFunction(node) {
  return FUNCTION_TYPES.includes(node.type);
}
function isPlainA(node) {
  return PLAIN_A_TYPES.includes(node.type);
}
function isPlainB(node) {
  return PLAIN_B_TYPES.includes(node.type);
}
function isPlainC(node) {
  return PLAIN_C_TYPES.includes(node.type);
}
function unreachable(_value) {}
function plainChildrenA(node) {
  switch (node.type) {
    case "BlockStatement":
      return node.body;
    case "ExpressionStatement":
      return [node.expression];
    case "ReturnStatement":
    case "ThrowStatement":
      return [node.argument];
    case "VariableDeclaration":
      return node.declarations;
    case "VariableDeclarator":
      return [node.id, node.init];
    case "AssignmentPattern":
      return [node.left, node.right];
    case "ObjectPattern":
      return node.properties;
    case "ArrayPattern":
      return node.elements;
    case "Property":
      return [node.key, node.value];
    case "RestElement":
      return [node.argument];
    case "TSParameterProperty":
      return [node.parameter];
    case "WithStatement":
      return [node.object, node.body];
    case "TSEnumDeclaration":
      return [node.body];
    case "TSEnumBody":
      return node.members;
    case "TSEnumMember":
      return [node.initializer];
    default:
      unreachable(node);
      return [];
  }
}
function plainChildrenB(node) {
  switch (node.type) {
    case "ClassDeclaration":
    case "ClassExpression":
      return [...node.decorators, node.id, node.superClass, node.body];
    case "ClassBody":
      return node.body;
    case "MethodDefinition":
    case "TSAbstractMethodDefinition":
      return [node.key, node.value];
    case "PropertyDefinition":
    case "TSAbstractPropertyDefinition":
    case "AccessorProperty":
    case "TSAbstractAccessorProperty":
      return [node.key, node.value];
    case "ObjectExpression":
      return node.properties;
    case "ArrayExpression":
      return node.elements;
    default:
      unreachable(node);
      return [];
  }
}
function plainChildrenC(node) {
  switch (node.type) {
    case "AwaitExpression":
    case "UnaryExpression":
    case "UpdateExpression":
    case "SpreadElement":
      return [node.argument];
    case "YieldExpression":
      return [node.argument];
    case "BinaryExpression":
      return [node.left, node.right];
    case "AssignmentExpression":
      return [node.left, node.right];
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSNonNullExpression":
    case "ChainExpression":
    case "ParenthesizedExpression":
    case "Decorator":
    case "TSInstantiationExpression":
      return [node.expression];
    case "MemberExpression":
    case "JSXMemberExpression":
      return [node.object, node.property];
    case "TemplateLiteral":
      return node.expressions;
    case "TaggedTemplateExpression":
      return [node.tag, node.quasi];
    case "SequenceExpression":
      return node.expressions;
    case "JSXElement":
      return [node.openingElement, ...node.children];
    case "JSXFragment":
      return node.children;
    case "JSXOpeningElement":
      return node.attributes;
    case "JSXAttribute":
      return [node.value];
    case "JSXExpressionContainer":
    case "JSXSpreadChild":
      return [node.expression];
    case "JSXSpreadAttribute":
      return [node.argument];
    default:
      unreachable(node);
      return [];
  }
}

// effect-channel/cognitive.ts
function unreachable2(_value) {}
function scoreList(state, nodes, nesting, parent, nested) {
  for (const node of nodes) {
    if (node !== null)
      score(state, node, nesting, parent, nested);
  }
}
function score(state, node, nesting, parent, nested) {
  if (isControl(node))
    return scoreControl(state, node, nesting, nested);
  if (isLoop(node))
    return scoreLoop(state, node, nesting, nested);
  if (isCall(node))
    return scoreCall(state, node, nesting, parent, nested);
  if (isFunction(node))
    return scoreFunction(state, node, nesting);
  if (isPlainA(node))
    return scoreList(state, plainChildrenA(node), nesting, node, nested);
  if (isPlainB(node))
    return scoreList(state, plainChildrenB(node), nesting, node, nested);
  if (isPlainC(node))
    return scoreList(state, plainChildrenC(node), nesting, node, nested);
}
function scoreIf(state, node, nesting, nested) {
  score(state, node.test, nesting, node, nested);
  state.total += 1 + nesting;
  score(state, node.consequent, nesting + 1, node, nested);
  const alternate = node.alternate;
  if (alternate === null)
    return;
  if (alternate.type === "IfStatement") {
    state.total += 1;
    return scoreElseIf(state, alternate, nesting + 1, nested);
  }
  state.total += 1;
  score(state, alternate, nesting + 1, node, nested);
}
function scoreElseIf(state, node, nesting, nested) {
  score(state, node.test, nesting, node, nested);
  score(state, node.consequent, nesting, node, nested);
  const alternate = node.alternate;
  if (alternate === null)
    return;
  if (alternate.type === "IfStatement") {
    state.total += 1;
    return scoreElseIf(state, alternate, nesting + 1, nested);
  }
  state.total += 1;
  score(state, alternate, nesting, node, nested);
}
function scoreControl(state, node, nesting, nested) {
  switch (node.type) {
    case "IfStatement": {
      return scoreIf(state, node, nesting, nested);
    }
    case "ConditionalExpression": {
      state.total += 1 + nesting;
      score(state, node.test, nesting, node, nested);
      score(state, node.consequent, nesting + 1, node, nested);
      score(state, node.alternate, nesting + 1, node, nested);
      return;
    }
    case "SwitchStatement": {
      state.total += 1 + nesting;
      score(state, node.discriminant, nesting, node, nested);
      scoreList(state, node.cases, nesting + 1, node, nested);
      return;
    }
    case "SwitchCase": {
      if (node.test !== null)
        score(state, node.test, nesting, node, nested);
      scoreList(state, node.consequent, nesting, node, nested);
      return;
    }
    case "TryStatement": {
      score(state, node.block, nesting, node, nested);
      if (node.handler !== null)
        score(state, node.handler, nesting, node, nested);
      if (node.finalizer !== null)
        score(state, node.finalizer, nesting, node, nested);
      return;
    }
    case "CatchClause": {
      state.total += 1 + nesting;
      if (node.param !== null)
        score(state, node.param, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    default: {
      return unreachable2(node);
    }
  }
}
function scoreLoop(state, node, nesting, nested) {
  switch (node.type) {
    case "ForStatement": {
      state.total += 1 + nesting;
      if (node.init !== null)
        score(state, node.init, nesting, node, nested);
      if (node.test !== null)
        score(state, node.test, nesting, node, nested);
      if (node.update !== null)
        score(state, node.update, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    case "ForInStatement":
    case "ForOfStatement": {
      state.total += 1 + nesting;
      score(state, node.left, nesting, node, nested);
      score(state, node.right, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    case "WhileStatement": {
      state.total += 1 + nesting;
      score(state, node.test, nesting, node, nested);
      score(state, node.body, nesting + 1, node, nested);
      return;
    }
    case "DoWhileStatement": {
      state.total += 1 + nesting;
      score(state, node.body, nesting + 1, node, nested);
      score(state, node.test, nesting, node, nested);
      return;
    }
    case "LabeledStatement": {
      score(state, node.body, nesting, node, nested);
      return;
    }
    default: {
      return unreachable2(node);
    }
  }
}
function insideRun(parent) {
  return parent !== null && parent.type === "LogicalExpression" && (parent.operator === "&&" || parent.operator === "||");
}
function countRuns(node, parentOperator) {
  if (node.type !== "LogicalExpression")
    return 0;
  if (node.operator !== "&&" && node.operator !== "||")
    return 0;
  const own = node.operator === parentOperator ? 0 : 1;
  return own + countRuns(node.left, node.operator) + countRuns(node.right, node.operator);
}
function isSelfCall(state, callee) {
  if (callee.type === "Identifier")
    return state.names.includes(callee.name);
  if (callee.type === "MemberExpression" && callee.object.type === "ThisExpression" && callee.property.type === "Identifier") {
    return state.names.includes(callee.property.name);
  }
  return false;
}
function scoreCall(state, node, nesting, parent, nested) {
  switch (node.type) {
    case "LogicalExpression": {
      if (!insideRun(parent) && (node.operator === "&&" || node.operator === "||"))
        state.total += countRuns(node, null);
      score(state, node.left, nesting, node, nested);
      score(state, node.right, nesting, node, nested);
      return;
    }
    case "BreakStatement":
    case "ContinueStatement": {
      if (node.label !== null)
        state.total += 1;
      return;
    }
    case "CallExpression":
    case "NewExpression": {
      if (!nested && isSelfCall(state, node.callee))
        state.recursive = true;
      score(state, node.callee, nesting, node, nested);
      scoreList(state, node.arguments, nesting, node, nested);
      return;
    }
    case "ImportExpression": {
      score(state, node.source, nesting, node, nested);
      if (node.options !== null)
        score(state, node.options, nesting, node, nested);
      return;
    }
    default: {
      return unreachable2(node);
    }
  }
}
function scoreFunction(state, node, nesting) {
  switch (node.type) {
    case "ArrowFunctionExpression": {
      scoreList(state, node.params, nesting + 1, node, true);
      score(state, node.body, nesting + 1, node, true);
      return;
    }
    case "StaticBlock": {
      scoreList(state, node.body, nesting + 1, node, true);
      return;
    }
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression": {
      scoreList(state, node.params, nesting + 1, node, true);
      if (node.body !== null)
        score(state, node.body, nesting + 1, node, true);
      return;
    }
    default: {
      return unreachable2(node);
    }
  }
}
function cognitiveComplexity(root, names) {
  const state = { total: 0, recursive: false, names };
  if (root.type === "StaticBlock") {
    scoreList(state, root.body, 0, root, false);
    return state.total;
  }
  scoreList(state, root.params, 0, root, false);
  if (root.type === "ArrowFunctionExpression")
    score(state, root.body, 0, root, false);
  else if (root.body !== null)
    score(state, root.body, 0, root, false);
  return state.recursive ? state.total + 1 : state.total;
}

// effect-channel/cognitive-complexity.ts
var DEFAULT_MAX = 15;
function isNode(value) {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}
function ancestorsOf(context, node) {
  return context.sourceCode.getAncestors(node).filter(isNode);
}
function maxOf(options) {
  const [first] = options;
  if (typeof first === "object" && first !== null && "max" in first && typeof first.max === "number" && first.max > 0) {
    return Math.floor(first.max);
  }
  return DEFAULT_MAX;
}
function keyName(key) {
  if (key.type === "Identifier")
    return key.name;
  if (key.type === "Literal" && typeof key.value === "string")
    return key.value;
  return;
}
function declaratorName(ancestors) {
  const declarator = ancestors.findLast((ancestor) => ancestor.type === "VariableDeclarator");
  if (declarator !== undefined && declarator.id.type === "Identifier") {
    return declarator.id.name;
  }
  return;
}
function memberName(ancestors) {
  const holder = ancestors.findLast((ancestor) => ancestor.type === "Property" || ancestor.type === "MethodDefinition");
  if (holder !== undefined && (holder.type === "Property" || holder.type === "MethodDefinition"))
    return keyName(holder.key);
  return;
}
function assignmentName(ancestors) {
  const assignment = ancestors.findLast((ancestor) => ancestor.type === "AssignmentExpression");
  if (assignment === undefined)
    return;
  if (assignment.left.type === "Identifier")
    return assignment.left.name;
  if (assignment.left.type === "MemberExpression" && assignment.left.object.type === "ThisExpression" && assignment.left.property.type === "Identifier") {
    return assignment.left.property.name;
  }
  return;
}
function displayName(node, ancestors) {
  if (node.type !== "ArrowFunctionExpression" && node.id !== null)
    return node.id.name;
  return declaratorName(ancestors) ?? memberName(ancestors) ?? assignmentName(ancestors) ?? "anonymous";
}
function recursionNames(node, ancestors) {
  const own = node.type === "ArrowFunctionExpression" ? undefined : node.id?.name;
  const bound = declaratorName(ancestors) ?? memberName(ancestors) ?? assignmentName(ancestors);
  const names = [own, bound];
  return names.filter((name) => name !== undefined);
}
var rule = {
  meta: {
    type: "problem",
    docs: { description: "Hold each function to a cognitive complexity of 15" },
    schema: [{ type: "object", properties: { max: { type: "number" } }, additionalProperties: false }],
    defaultOptions: [{ max: DEFAULT_MAX }]
  },
  create(context) {
    const max = maxOf(context.options);
    const check = (node) => {
      const ancestors = ancestorsOf(context, node);
      const score2 = node.type === "StaticBlock" ? cognitiveComplexity(node, []) : cognitiveComplexity(node, recursionNames(node, ancestors));
      if (score2 <= max)
        return;
      const name = node.type === "StaticBlock" ? "static block" : `function \`${displayName(node, ancestors)}\``;
      context.report({ node, message: `${name} has a cognitive complexity of ${score2}. Maximum allowed is ${max}.` });
    };
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
      StaticBlock: check
    };
  }
};
var cognitive_complexity_default = rule;

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
var rule2 = {
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
var no_error_channel_escape_default = rule2;

// effect-channel/no-throw.ts
var rule3 = {
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
var no_throw_default = rule3;

// effect-channel/no-try-catch.ts
var rule4 = {
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
var no_try_catch_default = rule4;

// effect-channel/index.ts
var plugin = {
  meta: { name: "effect-channel" },
  rules: {
    "no-error-channel-escape": no_error_channel_escape_default,
    "no-throw": no_throw_default,
    "no-try-catch": no_try_catch_default,
    "cognitive-complexity": cognitive_complexity_default
  }
};
var effect_channel_default = plugin;
export {
  effect_channel_default as default
};
