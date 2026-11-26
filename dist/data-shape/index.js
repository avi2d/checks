// src/quality/data-shape/no-reduce-accumulator-copy.ts
/*!
Adapted from the no-reduce-accumulator-copy rule of anti-slop, https://github.com/dmmulroy/anti-slop

MIT License

Copyright (c) 2026 Dillon Mulroy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
var REDUCERS = new Set(["reduce", "reduceRight"]);
var ARRAY_COPIES = new Set(["concat", "slice", "toSpliced", "toSorted", "toReversed", "with"]);
var ARRAY_RESULTS = new Set(["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"]);
var ARRAY_TYPE_NAMES = new Set(["Array", "ReadonlyArray"]);
function unwrap(node) {
  let current = node;
  while (current.type === "ParenthesizedExpression" || current.type === "ChainExpression" || current.type === "TSAsExpression" || current.type === "TSTypeAssertion" || current.type === "TSNonNullExpression" || current.type === "TSSatisfiesExpression") {
    current = current.expression;
  }
  return current;
}
function binding(sourceCode, node) {
  const target = unwrap(node);
  if (target.type !== "Identifier")
    return;
  let scope = sourceCode.getScope(target);
  while (scope !== null) {
    const variable = scope.set.get(target.name);
    if (variable !== undefined)
      return variable;
    scope = scope.upper;
  }
  return;
}
function methodOf(callee) {
  const member = unwrap(callee);
  if (member.type !== "MemberExpression")
    return;
  const { property } = member;
  if (!member.computed && property.type === "Identifier")
    return { name: property.name, object: member.object };
  if (member.computed && property.type === "Literal" && typeof property.value === "string") {
    return { name: property.value, object: member.object };
  }
  return;
}
function reassigned(variable) {
  return variable.references.some((reference) => reference.isWrite() && !reference.init);
}
function constInit(variable) {
  for (const definition of variable.defs) {
    const { node } = definition;
    if (definition.type !== "Variable" || node.type !== "VariableDeclarator")
      continue;
    if (node.id.type !== "Identifier" || node.init === null)
      continue;
    if (node.parent.type === "VariableDeclaration" && node.parent.kind === "const")
      return node.init;
  }
  return;
}
function readsAccumulator(sourceCode, node, accumulator, seen) {
  const variable = binding(sourceCode, node);
  if (variable === undefined || seen.has(variable))
    return false;
  if (variable === accumulator)
    return true;
  seen.add(variable);
  if (reassigned(variable))
    return false;
  const init = constInit(variable);
  return init !== undefined && readsAccumulator(sourceCode, init, accumulator, seen);
}
function isArrayType(type) {
  if (type.type === "TSArrayType" || type.type === "TSTupleType")
    return true;
  if (type.type === "TSParenthesizedType")
    return isArrayType(type.typeAnnotation);
  if (type.type === "TSTypeOperator" && type.operator === "readonly")
    return isArrayType(type.typeAnnotation);
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && ARRAY_TYPE_NAMES.has(type.typeName.name);
}
function annotation(variable) {
  for (const identifier of variable.identifiers) {
    if ("typeAnnotation" in identifier && identifier.typeAnnotation)
      return identifier.typeAnnotation.typeAnnotation;
  }
  return;
}
function isKnownArray(sourceCode, node, seen) {
  const value = unwrap(node);
  if (value.type === "ArrayExpression")
    return true;
  if (value.type === "CallExpression") {
    const method = methodOf(value.callee);
    return method !== undefined && ARRAY_RESULTS.has(method.name) && isKnownArray(sourceCode, method.object, seen);
  }
  const variable = binding(sourceCode, value);
  if (variable === undefined || seen.has(variable))
    return false;
  seen.add(variable);
  if (reassigned(variable))
    return false;
  const type = annotation(variable);
  if (type !== undefined)
    return isArrayType(type);
  const init = constInit(variable);
  return init !== undefined && isKnownArray(sourceCode, init, seen);
}
function isCallback(node) {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}
function nearestFunction(node) {
  let current = node.parent;
  while (current !== null) {
    if (current.type === "FunctionDeclaration")
      return;
    if (isCallback(current))
      return current;
    current = current.parent;
  }
  return;
}
function reducerCall(callback) {
  let owner = callback.parent;
  while (owner !== null && unwrap(owner) === callback)
    owner = owner.parent;
  if (owner?.type !== "CallExpression" || owner.arguments.length > 2)
    return;
  const method = methodOf(owner.callee);
  const [first] = owner.arguments;
  if (method === undefined || !REDUCERS.has(method.name) || first === undefined)
    return;
  return unwrap(first) === callback ? owner : undefined;
}
function enclosingReducer(sourceCode, node) {
  const callback = nearestFunction(node);
  if (callback === undefined)
    return;
  const call = reducerCall(callback);
  if (call === undefined)
    return;
  const [first] = callback.params;
  const parameter = first?.type === "AssignmentPattern" ? first.left : first;
  if (parameter?.type !== "Identifier")
    return;
  const accumulator = sourceCode.getDeclaredVariables(callback).find((variable) => variable.identifiers.some((identifier) => identifier.start === parameter.start));
  return accumulator === undefined ? undefined : { accumulator, initialValue: call.arguments[1] };
}
function isGlobal(sourceCode, node, name) {
  const owner = unwrap(node);
  if (owner.type !== "Identifier" || owner.name !== name)
    return false;
  const variable = binding(sourceCode, owner);
  return variable === undefined || variable.defs.length === 0;
}
var GROWS = "on every step, so the work grows with the square of the input when the accumulator grows with the input";
function copyMessage(sourceCode, call, method, reducer) {
  const name = reducer.accumulator.name;
  const reads = (node) => readsAccumulator(sourceCode, node, reducer.accumulator, new Set);
  const [first, ...rest] = call.arguments;
  if (method.name === "assign" && isGlobal(sourceCode, method.object, "Object")) {
    if (first === undefined || unwrap(first).type !== "ObjectExpression" || !rest.some(reads))
      return;
    return `\`Object.assign\` into a new object copies the reduce accumulator \`${name}\` ${GROWS}. Assign into the accumulator, as in \`Object.assign(${name}, item)\`, and return it.`;
  }
  if (method.name === "from" && isGlobal(sourceCode, method.object, "Array")) {
    if (first === undefined || !reads(first))
      return;
    return `\`Array.from\` copies the reduce accumulator \`${name}\` ${GROWS}. Push into the accumulator and return it.`;
  }
  if (!ARRAY_COPIES.has(method.name) || reducer.initialValue === undefined)
    return;
  if (!isKnownArray(sourceCode, reducer.initialValue, new Set) || !reads(method.object))
    return;
  return `\`.${method.name}()\` copies the reduce accumulator \`${name}\` ${GROWS}. Change the accumulator in place, as with \`push\`, and return it.`;
}
var rule = {
  meta: {
    type: "problem",
    docs: { description: "Refuse a reduce callback that copies its accumulator with Object.assign, Array.from or an array copy method" }
  },
  create(context) {
    return {
      CallExpression: (node) => {
        const method = methodOf(node.callee);
        if (method === undefined)
          return;
        const reducer = enclosingReducer(context.sourceCode, node);
        if (reducer === undefined)
          return;
        const message = copyMessage(context.sourceCode, node, method, reducer);
        if (message !== undefined)
          context.report({ node, message });
      }
    };
  }
};
var no_reduce_accumulator_copy_default = rule;

// src/quality/data-shape/no-shell-in-strings.ts
var LEAST_SHELL_LINES = 5;
var SHELL_MARKS = [
  /^#!\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|da|z)?sh\b/u,
  /^(?:if|elif|while|until)\s+(?![\s(])/u,
  /^(?:then|fi|do|done|esac)\s*(?:;|$)/u,
  /^case\s.+\sin$/u,
  /;\s*(?:then|do)$/u,
  /;;/u,
  /(?<![\w$])\$\((?!["'`])/u,
  /"\$@"/u,
  /\$\{[A-Za-z_]\w*[:#%/}]/u,
  /&&|\|\|/u,
  /^(?:trap|exec)\s/u
];
var JAVASCRIPT_MARKS = /\b(?:const|let|var|function|await|import|export|typeof|new)\s|=>|===|!==|\bconsole\.|[{(]$|^[)}]|(?<!;);$/u;
function readsAsShell(text) {
  const line = text.trim();
  return SHELL_MARKS.some((mark) => mark.test(line)) && !JAVASCRIPT_MARKS.test(line);
}
function split(node, text) {
  return text.split(`
`).map((line) => ({ node, text: line }));
}
function joined(parts) {
  const found = parts.flatMap((part) => part === null || part.type === "SpreadElement" ? [] : [textLines(part)]);
  const lines = found.filter((one) => one !== undefined);
  return lines.length === 0 ? undefined : lines.flat();
}
function chainSegments(node) {
  if (node.type === "Literal")
    return typeof node.value === "string" ? [{ node, text: node.value }] : undefined;
  if (node.type === "TemplateLiteral")
    return [{ node, text: node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("") }];
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = chainSegments(node.left) ?? [];
    const right = chainSegments(node.right) ?? [];
    return left.length === 0 && right.length === 0 ? undefined : [...left, ...right];
  }
  return;
}
function textLines(node) {
  if (node.type === "Literal")
    return typeof node.value === "string" ? split(node, node.value) : undefined;
  if (node.type === "TemplateLiteral")
    return split(node, node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(""));
  if (node.type === "ArrayExpression")
    return joined(node.elements);
  if (node.type === "BinaryExpression" && node.operator === "+")
    return chainLines(chainSegments(node));
  return;
}
function chainLines(segments) {
  const first = segments?.[0];
  if (segments === undefined || first === undefined)
    return;
  const lines = [];
  let owner = first.node;
  let current = "";
  for (const segment of segments) {
    const parts = segment.text.split(`
`);
    const [head = "", ...tail] = parts;
    if (current === "")
      owner = segment.node;
    current += head;
    for (const part of tail) {
      lines.push({ node: owner, text: current });
      owner = segment.node;
      current = part;
    }
  }
  lines.push({ node: owner, text: current });
  return lines;
}
function insideLargerString(node) {
  const { parent } = node;
  return parent?.type === "ArrayExpression" || parent?.type === "BinaryExpression" && parent.operator === "+";
}
var rule2 = {
  meta: {
    type: "suggestion",
    docs: { description: "Refuse a shell program written as TypeScript strings, which no linter of either language reads" }
  },
  create(context) {
    const check = (node) => {
      if (insideLargerString(node))
        return;
      const shell = (textLines(node) ?? []).filter((line) => readsAsShell(line.text));
      const [first] = shell;
      if (first === undefined || shell.length < LEAST_SHELL_LINES)
        return;
      context.report({
        node: first.node,
        message: `These strings hold ${shell.length} lines that read as shell, the first \`${first.text.trim()}\`. Move the program to a .sh file the code runs, where a shell linter reads it.`
      });
    };
    return { Literal: check, TemplateLiteral: check, ArrayExpression: check, BinaryExpression: check };
  }
};
var no_shell_in_strings_default = rule2;

// src/quality/data-shape/readonly-collection-param.ts
var ARRAY_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin"
]);
var COLLECTION_METHODS = new Set(["set", "delete", "clear", "add"]);
var HANDOFF_PARENTS = new Set([
  "ArrayExpression",
  "ReturnStatement",
  "YieldExpression",
  "JSXExpressionContainer",
  "JSXSpreadAttribute"
]);
var READONLY_NAMES = new Set(["ReadonlyArray", "ReadonlyMap", "ReadonlySet"]);
function isArrayType2(type) {
  if (type === undefined)
    return false;
  if (type.type === "TSArrayType")
    return true;
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && type.typeName.name === "Array";
}
function isMapOrSet(type) {
  return type?.type === "TSTypeReference" && type.typeName.type === "Identifier" && (type.typeName.name === "Map" || type.typeName.name === "Set");
}
function namedOf(param) {
  if (param.type === "Identifier")
    return { name: param.name, type: param.typeAnnotation?.typeAnnotation };
  if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
    return { name: param.left.name, type: param.left.typeAnnotation?.typeAnnotation };
  }
  return;
}
function isReadonlyType(type) {
  if (type?.type === "TSTypeOperator")
    return type.operator === "readonly";
  return type?.type === "TSTypeReference" && type.typeName.type === "Identifier" && READONLY_NAMES.has(type.typeName.name);
}
function declaredFunctions(program) {
  const found = new Map;
  for (const statement of program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration" ? statement.declaration : statement;
    if (declaration?.type === "FunctionDeclaration" && declaration.id !== null) {
      found.set(declaration.id.name, declaration.params);
    }
  }
  return found;
}
function isPassThrough(parent, child) {
  if (parent === null)
    return false;
  if (parent.type === "ConditionalExpression")
    return parent.test !== child;
  return parent.type === "LogicalExpression" || parent.type === "AwaitExpression" || parent.type === "TSAsExpression" || parent.type === "TSTypeAssertion" || parent.type === "TSSatisfiesExpression" || parent.type === "TSNonNullExpression";
}
function valuePosition(node) {
  let current = node;
  while (isPassThrough(current.parent, current))
    current = current.parent;
  return current;
}
function writtenObjects(target) {
  if (target === null)
    return [];
  if (target.type === "MemberExpression")
    return target.object.type === "Identifier" ? [target.object.name] : [];
  if (target.type === "ArrayPattern")
    return target.elements.flatMap((element) => writtenObjects(element));
  if (target.type === "ObjectPattern") {
    return target.properties.flatMap((one) => writtenObjects(one.type === "Property" ? one.value : one));
  }
  if (target.type === "AssignmentPattern")
    return writtenObjects(target.left);
  if (target.type === "RestElement")
    return writtenObjects(target.argument);
  return [];
}
function calledMethod(callee) {
  const { property } = callee;
  if (!callee.computed && property.type === "Identifier")
    return property.name;
  if (property.type === "Literal" && typeof property.value === "string")
    return property.value;
  return;
}
function watch(params) {
  const found = [];
  for (const param of params) {
    const named = namedOf(param);
    if (named === undefined || named.type === undefined)
      continue;
    if (isArrayType2(named.type))
      found.push({ name: named.name, type: named.type, methods: ARRAY_METHODS });
    else if (isMapOrSet(named.type))
      found.push({ name: named.name, type: named.type, methods: COLLECTION_METHODS });
  }
  return found;
}
function fixOf(type, text) {
  return type.type === "TSArrayType" ? `readonly ${text}` : `Readonly${text}`;
}
var rule3 = {
  meta: {
    type: "problem",
    docs: { description: "Type a collection parameter the function never mutates as readonly" }
  },
  create(context) {
    const stack = [];
    let functions = new Map;
    const mark = (name, method) => {
      for (let index = stack.length - 1;index >= 0; index--) {
        const frame = stack[index];
        if (frame === undefined)
          continue;
        const param = frame.watched.find((one) => one.name === name);
        if (param === undefined)
          continue;
        if (method === undefined || param.methods.has(method))
          frame.mutated.add(name);
        return;
      }
    };
    const enter = (node) => {
      stack.push({ watched: watch(node.body === null ? [] : node.params), mutated: new Set });
    };
    const leave = () => {
      const frame = stack.pop();
      if (frame === undefined)
        return;
      for (const param of frame.watched) {
        if (frame.mutated.has(param.name))
          continue;
        const text = context.sourceCode.getText(param.type);
        context.report({
          node: param.type,
          message: `parameter \`${param.name}\` is typed \`${text}\` but this function never mutates it. Type it \`${fixOf(param.type, text)}\` instead.`
        });
      }
    };
    const call = (node) => {
      const { callee } = node;
      if (callee.type !== "MemberExpression")
        return;
      const { object } = callee;
      if (object.type !== "Identifier")
        return;
      mark(object.name, calledMethod(callee));
    };
    const passedReadonly = (site, argument) => {
      if (site.callee.type !== "Identifier")
        return false;
      const params = functions.get(site.callee.name);
      const index = site.arguments.findIndex((one) => one === argument);
      const param = params?.[index];
      return param !== undefined && isReadonlyType(namedOf(param)?.type);
    };
    const escapes = (node) => {
      const value = valuePosition(node);
      const { parent } = value;
      if (parent === null)
        return false;
      if (parent.type === "CallExpression" || parent.type === "NewExpression") {
        return parent.callee !== value && !passedReadonly(parent, value);
      }
      if (parent.type === "VariableDeclarator")
        return parent.init === value;
      if (parent.type === "AssignmentExpression" || parent.type === "AssignmentPattern")
        return parent.right === value;
      if (parent.type === "Property" || parent.type === "PropertyDefinition")
        return parent.value === value;
      if (parent.type === "ArrowFunctionExpression")
        return parent.body === value;
      return HANDOFF_PARENTS.has(parent.type);
    };
    const written = (target) => {
      for (const name of writtenObjects(target))
        mark(name, undefined);
    };
    return {
      Program: (node) => {
        functions = declaredFunctions(node);
      },
      Identifier: (node) => {
        if (escapes(node))
          mark(node.name, undefined);
      },
      FunctionDeclaration: enter,
      FunctionExpression: enter,
      ArrowFunctionExpression: enter,
      "FunctionDeclaration:exit": leave,
      "FunctionExpression:exit": leave,
      "ArrowFunctionExpression:exit": leave,
      CallExpression: call,
      AssignmentExpression: (node) => {
        written(node.left);
      },
      UpdateExpression: (node) => {
        written(node.argument);
      },
      UnaryExpression: (node) => {
        if (node.operator === "delete" && node.argument.type === "MemberExpression")
          written(node.argument);
      },
      ForOfStatement: (node) => {
        written(node.left);
      },
      ForInStatement: (node) => {
        written(node.left);
      }
    };
  }
};
var readonly_collection_param_default = rule3;

// src/quality/data-shape/schema-twin.ts
var STRUCTS = new Set(["Struct", "TaggedStruct", "Class", "TaggedError"]);
var REFINEMENTS = new Set(["check", "annotate"]);
var SCHEMA_KINDS = {
  String: "string",
  NonEmptyString: "string",
  Trimmed: "string",
  Literal: "literal",
  Literals: "literal",
  Number: "number",
  Finite: "number",
  Int: "number",
  NonNegativeInt: "number",
  Boolean: "boolean",
  Array: "array",
  NonEmptyArray: "array",
  Struct: "object",
  TaggedStruct: "object",
  Record: "record",
  Unknown: "unknown"
};
function keyName(key) {
  if (key.type === "Identifier")
    return key.name;
  if (key.type === "Literal" && typeof key.value === "string")
    return key.value;
  return;
}
function typeKind(type) {
  const value = type?.type === "TSTypeOperator" ? type.typeAnnotation : type;
  if (value === undefined)
    return "wild";
  if (value.type === "TSStringKeyword")
    return "string";
  if (value.type === "TSNumberKeyword")
    return "number";
  if (value.type === "TSBooleanKeyword")
    return "boolean";
  if (value.type === "TSArrayType")
    return "array";
  if (value.type === "TSTypeLiteral")
    return "object";
  if (value.type === "TSLiteralType")
    return "literal";
  if (value.type === "TSUnknownKeyword")
    return "unknown";
  if (value.type === "TSTypeReference")
    return referenceKind(value);
  if (value.type === "TSUnionType" && value.types.every((one) => one.type === "TSLiteralType"))
    return "literal";
  return "wild";
}
function referenceKind(value) {
  if (value.typeName.type !== "Identifier")
    return "wild";
  if (value.typeName.name === "Array" || value.typeName.name === "ReadonlyArray")
    return "array";
  if (value.typeName.name === "Record" || value.typeName.name === "ReadonlyRecord")
    return "record";
  return "wild";
}
function schemaCallName(node, isSchema) {
  if (node === undefined)
    return;
  if (node.type === "CallExpression")
    return schemaCallName(node.callee, isSchema);
  if (node.type !== "MemberExpression")
    return;
  const { object, property } = node;
  if (node.computed || property.type !== "Identifier" || object.type !== "Identifier" || !isSchema(object))
    return;
  return property.name;
}
function kindOf(name) {
  return name === undefined ? "wild" : SCHEMA_KINDS[name] ?? "wild";
}
function refinedBase(value) {
  const { callee } = value;
  if (callee.type !== "MemberExpression" || callee.object.type === "Super")
    return;
  if (callee.property.type !== "Identifier" || !REFINEMENTS.has(callee.property.name))
    return;
  return callee.object;
}
function literalKey(value) {
  return typeof value === "bigint" ? `${value}n` : JSON.stringify(value);
}
function schemaLiteral(value, name) {
  const arg = value.arguments[0];
  return name === "Literal" && value.arguments.length === 1 && arg?.type === "Literal" ? literalKey(arg.value) : undefined;
}
function schemaKind(value, isSchema) {
  if (value !== undefined && value.type === "CallExpression") {
    const name = schemaCallName(value.callee, isSchema);
    if (name === "optionalKey") {
      const first = value.arguments[0];
      const inner = first === undefined || first.type === "SpreadElement" ? undefined : first;
      return { ...schemaKind(inner, isSchema), optional: true };
    }
    const base = refinedBase(value);
    if (base !== undefined)
      return schemaKind(base, isSchema);
    const literal = schemaLiteral(value, name);
    if (literal !== undefined)
      return { optional: false, kind: "literal", literal };
    return { optional: false, kind: kindOf(name) };
  }
  return { optional: false, kind: kindOf(schemaCallName(value, isSchema)) };
}
function shapeFields(node) {
  const members = node.type === "TSTypeLiteral" ? node.members : node.body;
  const found = [];
  for (const member of members) {
    if (member.type !== "TSPropertySignature" || member.computed)
      return [];
    const name = keyName(member.key);
    if (name === undefined)
      return [];
    const type = member.typeAnnotation?.typeAnnotation;
    const literal = type?.type === "TSLiteralType" && type.literal.type === "Literal" ? literalKey(type.literal.value) : undefined;
    found.push({ name, optional: member.optional, kind: typeKind(type), ...literal === undefined ? {} : { literal } });
  }
  return found;
}
function tagField(call, tagged) {
  if (!tagged)
    return [];
  const tag = call.arguments[0];
  if (tag?.type !== "Literal" || typeof tag.value !== "string")
    return;
  return [{ name: "_tag", optional: false, kind: "literal", literal: literalKey(tag.value) }];
}
function schemaFields(call, isSchema) {
  const { callee } = call;
  const inner = callee.type === "CallExpression" ? callee.callee : callee;
  if (inner.type !== "MemberExpression")
    return;
  const { object, property } = inner;
  if (inner.computed || property.type !== "Identifier" || !STRUCTS.has(property.name) || object.type !== "Identifier" || !isSchema(object)) {
    return;
  }
  const fields = call.arguments.find((one) => one.type === "ObjectExpression");
  if (fields === undefined)
    return;
  const found = tagField(call, property.name === "TaggedStruct" || property.name === "TaggedError");
  if (found === undefined)
    return;
  for (const prop of fields.properties) {
    if (prop.type !== "Property" || prop.computed)
      return;
    const name = keyName(prop.key);
    if (name === undefined)
      return;
    found.push({ name, ...schemaKind(prop.value, isSchema) });
  }
  return found.length >= 2 ? found : undefined;
}
function twins(typeFields, schema) {
  return typeFields.length === schema.length && typeFields.every((field) => {
    const match = schema.find((one) => one.name === field.name);
    return match !== undefined && match.optional === field.optional && field.kind === match.kind && !["wild", "array", "object", "record"].includes(field.kind) && (field.kind !== "literal" || field.literal !== undefined && field.literal === match.literal);
  });
}
function schemaName(call) {
  const { parent } = call;
  if (parent.type === "ClassDeclaration" && parent.id !== null)
    return parent.id.name;
  if (parent.type !== "VariableDeclarator" || parent.id.type !== "Identifier")
    return;
  return parent.id.name;
}
function shapeName(node) {
  const { parent } = node;
  if (parent.type !== "TSTypeAliasDeclaration" && parent.type !== "TSInterfaceDeclaration")
    return;
  return parent.id.name;
}
function describeTwin(type, schema, encoded) {
  const subject = type === undefined ? "This object type" : `Type \`${type}\``;
  if (schema === undefined)
    return `${subject} repeats the fields of a Schema in this file. Derive it from the schema instead of writing both.`;
  return `${subject} repeats the fields of schema \`${schema}\` in this file. Derive it as \`typeof ${schema}.${encoded ? "Encoded" : "Type"}\` instead of writing both.`;
}
var rule4 = {
  meta: {
    type: "problem",
    docs: { description: "Derive an object type from the Schema it repeats instead of writing both" }
  },
  create(context) {
    const shapes = [];
    const schemas = [];
    const isSchema = (node) => {
      let scope = context.sourceCode.getScope(node);
      while (scope !== null) {
        const variable = scope.set.get(node.name);
        if (variable !== undefined)
          return variable.defs.some((def) => def.type === "ImportBinding" && def.parent?.type === "ImportDeclaration" && (def.node.type === "ImportSpecifier" && def.parent.source.value === "effect" && def.node.imported.type === "Identifier" && def.node.imported.name === "Schema" || def.node.type === "ImportNamespaceSpecifier" && def.parent.source.value === "effect/Schema"));
        scope = scope.upper;
      }
      return false;
    };
    const collect = (node) => {
      if (node.parent.type === "TSInterfaceDeclaration" && node.parent.extends.length > 0)
        return;
      const fields = shapeFields(node);
      if (fields.length >= 2)
        shapes.push({ node, fields });
    };
    return {
      TSTypeLiteral: collect,
      TSInterfaceBody: collect,
      CallExpression(node) {
        const fields = schemaFields(node, isSchema);
        if (fields !== undefined)
          schemas.push({ name: schemaName(node), fields, encoded: node.parent.type === "ClassDeclaration" });
      },
      "Program:exit"() {
        for (const shape of shapes) {
          const twin = schemas.find((schema) => twins(shape.fields, schema.fields));
          if (twin === undefined)
            continue;
          context.report({ node: shape.node, message: describeTwin(shapeName(shape.node), twin.name, twin.encoded) });
        }
      }
    };
  }
};
var schema_twin_default = rule4;

// src/quality/data-shape/index.ts
var plugin = {
  meta: { name: "data-shape" },
  rules: {
    "no-reduce-accumulator-copy": no_reduce_accumulator_copy_default,
    "no-shell-in-strings": no_shell_in_strings_default,
    "readonly-collection-param": readonly_collection_param_default,
    "schema-twin": schema_twin_default
  }
};
var data_shape_default = plugin;
export {
  data_shape_default as default
};
