// src/complexity/readability/cognitive-nodes.ts
var CONTROL_TYPES = ["IfStatement", "ConditionalExpression", "SwitchStatement", "SwitchCase", "TryStatement", "CatchClause"];
var LOOP_TYPES = ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement", "LabeledStatement"];
var CALL_TYPES = ["LogicalExpression", "BreakStatement", "ContinueStatement", "CallExpression", "NewExpression", "ImportExpression"];
var FUNCTION_TYPES = ["FunctionDeclaration", "FunctionExpression", "TSDeclareFunction", "TSEmptyBodyFunctionExpression", "ArrowFunctionExpression", "StaticBlock"];
var PLAIN_A_TYPES = ["BlockStatement", "ExpressionStatement", "ReturnStatement", "ThrowStatement", "VariableDeclaration", "VariableDeclarator", "AssignmentPattern", "ObjectPattern", "ArrayPattern", "Property", "RestElement", "TSParameterProperty", "WithStatement", "TSEnumDeclaration", "TSEnumBody", "TSEnumMember"];
var PLAIN_B_TYPES = ["ClassDeclaration", "ClassExpression", "ClassBody", "MethodDefinition", "TSAbstractMethodDefinition", "PropertyDefinition", "TSAbstractPropertyDefinition", "AccessorProperty", "TSAbstractAccessorProperty", "ObjectExpression", "ArrayExpression"];
var PLAIN_C_TYPES = ["AwaitExpression", "UnaryExpression", "UpdateExpression", "SpreadElement", "YieldExpression", "BinaryExpression", "AssignmentExpression", "TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "ChainExpression", "ParenthesizedExpression", "Decorator", "TSInstantiationExpression", "MemberExpression", "JSXMemberExpression", "TemplateLiteral", "TaggedTemplateExpression", "SequenceExpression", "JSXElement", "JSXFragment", "JSXOpeningElement", "JSXAttribute", "JSXExpressionContainer", "JSXSpreadChild", "JSXSpreadAttribute"];

// src/complexity/readability/cognitive-plain.ts
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

// src/complexity/readability/cognitive.ts
function unreachable2(_value) {}
function scoreList(state, nodes, nesting, parent) {
  for (const node of nodes) {
    if (node !== null)
      score(state, node, nesting, parent);
  }
}
function score(state, node, nesting, parent) {
  if (isControl(node))
    return scoreControl(state, node, nesting);
  if (isLoop(node))
    return scoreLoop(state, node, nesting);
  if (isCall(node))
    return scoreCall(state, node, nesting, parent);
  if (isFunction(node))
    return;
  if (isPlainA(node))
    return scoreList(state, plainChildrenA(node), nesting, node);
  if (isPlainB(node))
    return scoreList(state, plainChildrenB(node), nesting, node);
  if (isPlainC(node))
    return scoreList(state, plainChildrenC(node), nesting, node);
}
function scoreBranch(state, node, nesting) {
  score(state, node.test, nesting, node);
  score(state, node.consequent, nesting + 1, node);
  const alternate = node.alternate;
  if (alternate === null)
    return;
  state.total += 1;
  if (alternate.type === "IfStatement")
    return scoreBranch(state, alternate, nesting);
  score(state, alternate, nesting + 1, node);
}
function scoreIf(state, node, nesting) {
  state.total += 1 + nesting;
  scoreBranch(state, node, nesting);
}
function scoreControl(state, node, nesting) {
  switch (node.type) {
    case "IfStatement": {
      return scoreIf(state, node, nesting);
    }
    case "ConditionalExpression": {
      state.total += 1 + nesting;
      score(state, node.test, nesting, node);
      score(state, node.consequent, nesting + 1, node);
      score(state, node.alternate, nesting + 1, node);
      return;
    }
    case "SwitchStatement": {
      state.total += 1 + nesting;
      score(state, node.discriminant, nesting, node);
      scoreList(state, node.cases, nesting + 1, node);
      return;
    }
    case "SwitchCase": {
      if (node.test !== null)
        score(state, node.test, nesting, node);
      scoreList(state, node.consequent, nesting, node);
      return;
    }
    case "TryStatement": {
      score(state, node.block, nesting, node);
      if (node.handler !== null)
        score(state, node.handler, nesting, node);
      if (node.finalizer !== null)
        score(state, node.finalizer, nesting, node);
      return;
    }
    case "CatchClause": {
      state.total += 1 + nesting;
      if (node.param !== null)
        score(state, node.param, nesting, node);
      score(state, node.body, nesting + 1, node);
      return;
    }
    default: {
      return unreachable2(node);
    }
  }
}
function scoreLoop(state, node, nesting) {
  switch (node.type) {
    case "ForStatement": {
      state.total += 1 + nesting;
      if (node.init !== null)
        score(state, node.init, nesting, node);
      if (node.test !== null)
        score(state, node.test, nesting, node);
      if (node.update !== null)
        score(state, node.update, nesting, node);
      score(state, node.body, nesting + 1, node);
      return;
    }
    case "ForInStatement":
    case "ForOfStatement": {
      state.total += 1 + nesting;
      score(state, node.left, nesting, node);
      score(state, node.right, nesting, node);
      score(state, node.body, nesting + 1, node);
      return;
    }
    case "WhileStatement": {
      state.total += 1 + nesting;
      score(state, node.test, nesting, node);
      score(state, node.body, nesting + 1, node);
      return;
    }
    case "DoWhileStatement": {
      state.total += 1 + nesting;
      score(state, node.body, nesting + 1, node);
      score(state, node.test, nesting, node);
      return;
    }
    case "LabeledStatement": {
      score(state, node.body, nesting, node);
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
    return state.names.identifiers.includes(callee.name);
  if (callee.type === "MemberExpression" && callee.object.type === "ThisExpression" && callee.property.type === "Identifier") {
    return state.names.members.includes(callee.property.name);
  }
  return false;
}
function scoreCall(state, node, nesting, parent) {
  switch (node.type) {
    case "LogicalExpression": {
      if (!insideRun(parent) && (node.operator === "&&" || node.operator === "||"))
        state.total += countRuns(node, null);
      score(state, node.left, nesting, node);
      score(state, node.right, nesting, node);
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
      if (isSelfCall(state, node.callee))
        state.recursive = true;
      score(state, node.callee, nesting, node);
      scoreList(state, node.arguments, nesting, node);
      return;
    }
    case "ImportExpression": {
      score(state, node.source, nesting, node);
      if (node.options !== null)
        score(state, node.options, nesting, node);
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
    scoreList(state, root.body, 0, root);
    return state.total;
  }
  scoreList(state, root.params, 0, root);
  if (root.type === "ArrowFunctionExpression")
    score(state, root.body, 0, root);
  else if (root.body !== null)
    score(state, root.body, 0, root);
  return state.recursive ? state.total + 1 : state.total;
}

// src/complexity/readability/cognitive-complexity.ts
var DEFAULT_MAX = 15;
function maxOf(options) {
  const [first] = options;
  if (typeof first === "object" && first !== null && "max" in first && typeof first.max === "number" && first.max > 0) {
    return Math.floor(first.max);
  }
  return DEFAULT_MAX;
}
function keyName(holder) {
  if (holder.computed)
    return;
  if (holder.key.type === "Identifier")
    return holder.key.name;
  if (holder.key.type === "Literal" && typeof holder.key.value === "string")
    return holder.key.value;
  return;
}
function assignedBinding(target) {
  if (target.type === "Identifier")
    return { kind: "identifiers", name: target.name };
  if (target.type === "MemberExpression" && target.object.type === "ThisExpression" && target.property.type === "Identifier") {
    return { kind: "members", name: target.property.name };
  }
  return;
}
function memberBinding(holder) {
  const name = keyName(holder);
  return name === undefined ? undefined : { kind: "members", name };
}
function binding(node) {
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.init === node && parent.id.type === "Identifier") {
    return { kind: "identifiers", name: parent.id.name };
  }
  if ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition" || parent.type === "AccessorProperty") && parent.value === node) {
    return memberBinding(parent);
  }
  if (parent.type === "AssignmentExpression" && parent.right === node)
    return assignedBinding(parent.left);
  return;
}
function displayName(node) {
  if (node.type !== "ArrowFunctionExpression" && node.id !== null)
    return node.id.name;
  return binding(node)?.name ?? "anonymous";
}
function selfNames(node) {
  const own = node.type === "ArrowFunctionExpression" || node.id === null ? [] : [node.id.name];
  const bound = binding(node);
  return {
    identifiers: bound?.kind === "identifiers" ? [...own, bound.name] : own,
    members: bound?.kind === "members" ? [bound.name] : []
  };
}
var NO_NAMES = { identifiers: [], members: [] };
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
      const score2 = node.type === "StaticBlock" ? cognitiveComplexity(node, NO_NAMES) : cognitiveComplexity(node, selfNames(node));
      if (score2 <= max)
        return;
      const name = node.type === "StaticBlock" ? "static block" : `function \`${displayName(node)}\``;
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

// src/complexity/readability/thin-astro.ts
function unwrapped(expression) {
  let current = expression;
  while (current.type === "TSAsExpression" || current.type === "TSSatisfiesExpression" || current.type === "TSNonNullExpression" || current.type === "TSTypeAssertion") {
    current = current.expression;
  }
  return current;
}
function isAstroProps(value) {
  if (value.type !== "MemberExpression" || value.computed)
    return false;
  const { object, property } = value;
  return object.type === "Identifier" && object.name === "Astro" && property.type === "Identifier" && property.name === "props";
}
function readsProps(expression, bound) {
  const value = unwrapped(expression);
  if (value.type === "MemberExpression")
    return isAstroProps(value) || readsProps(value.object, bound);
  return value.type === "Identifier" && bound.has(value.name);
}
function boundName(pattern, found) {
  if (pattern === null)
    return;
  if (pattern.type === "RestElement")
    boundName(pattern.argument, found);
  else if (pattern.type === "AssignmentPattern")
    boundName(pattern.left, found);
  else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties)
      boundName(property.type === "Property" ? property.value : property.argument, found);
  } else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements)
      boundName(element, found);
  } else
    found.add(pattern.name);
}
function isTypeDeclaration(statement) {
  const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  return declaration?.type === "TSInterfaceDeclaration" || declaration?.type === "TSTypeAliasDeclaration";
}
var rule2 = {
  meta: {
    type: "problem",
    docs: { description: "Disallow logic in .astro frontmatter: only imports, props and markup" }
  },
  create(context) {
    if (!context.filename.endsWith(".astro"))
      return {};
    const bound = new Set;
    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type === "ImportDeclaration" || statement.type === "EmptyStatement" || statement.type === "ExportNamedDeclaration" && statement.source !== null || isTypeDeclaration(statement)) {
            continue;
          }
          if (statement.type === "VariableDeclaration" && statement.declarations.length > 0 && statement.declarations.every((declarator) => declarator.init !== null && readsProps(declarator.init, bound))) {
            for (const declarator of statement.declarations)
              boundName(declarator.id, bound);
            continue;
          }
          context.report({
            node: statement,
            message: "frontmatter holds more than imports and props: move this statement into a .ts file and import it, so the .astro file holds only imports, props and markup"
          });
        }
      }
    };
  }
};
var thin_astro_default = rule2;

// src/complexity/readability/index.ts
var plugin = {
  meta: { name: "readability" },
  rules: {
    "cognitive-complexity": cognitive_complexity_default,
    "thin-astro": thin_astro_default
  }
};
var readability_default = plugin;
export {
  readability_default as default
};
