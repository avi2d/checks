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
function isArrayType(type) {
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
    if (isArrayType(named.type))
      found.push({ name: named.name, type: named.type, methods: ARRAY_METHODS });
    else if (isMapOrSet(named.type))
      found.push({ name: named.name, type: named.type, methods: COLLECTION_METHODS });
  }
  return found;
}
function fixOf(type, text) {
  return type.type === "TSArrayType" ? `readonly ${text}` : `Readonly${text}`;
}
var rule = {
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
var readonly_collection_param_default = rule;

// src/quality/data-shape/schema-twin.ts
var STRUCTS = new Set(["Struct", "TaggedStruct", "Class"]);
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
function schemaCallName(node) {
  if (node === undefined)
    return;
  if (node.type === "CallExpression")
    return schemaCallName(node.callee);
  if (node.type !== "MemberExpression")
    return;
  const { object, property } = node;
  if (object.type !== "Identifier" || object.name !== "Schema" || property.type !== "Identifier")
    return;
  return property.name;
}
function kindOf(name) {
  return name === undefined ? "wild" : SCHEMA_KINDS[name] ?? "wild";
}
function schemaKind(value) {
  if (value !== undefined && value.type === "CallExpression") {
    const name = schemaCallName(value.callee);
    if (name === "optionalKey" || name === "optional") {
      const first = value.arguments[0];
      const inner = first === undefined || first.type === "SpreadElement" ? undefined : first;
      return { optional: true, kind: schemaKind(inner).kind };
    }
    if (name === "NullOr" || name === "UndefinedOr" || name === "check" || name === "pipe") {
      return { optional: false, kind: "wild" };
    }
    return { optional: false, kind: kindOf(name) };
  }
  return { optional: false, kind: kindOf(schemaCallName(value)) };
}
function shapeFields(node) {
  const members = node.type === "TSTypeLiteral" ? node.members : node.body;
  const found = [];
  for (const member of members) {
    if (member.type !== "TSPropertySignature")
      continue;
    const name = keyName(member.key);
    if (name === undefined)
      continue;
    found.push({ name, optional: member.optional, kind: typeKind(member.typeAnnotation?.typeAnnotation) });
  }
  return found;
}
function schemaFields(call) {
  const { callee } = call;
  const inner = callee.type === "CallExpression" ? callee.callee : callee;
  if (inner.type !== "MemberExpression")
    return;
  const { object, property } = inner;
  if (object.type !== "Identifier" || object.name !== "Schema" || property.type !== "Identifier" || !STRUCTS.has(property.name)) {
    return;
  }
  const fields = call.arguments.find((one) => one.type === "ObjectExpression");
  if (fields === undefined)
    return;
  const found = property.name === "TaggedStruct" ? [{ name: "_tag", optional: false, kind: "literal" }] : [];
  for (const prop of fields.properties) {
    if (prop.type !== "Property" || prop.computed)
      continue;
    const name = keyName(prop.key);
    if (name === undefined)
      continue;
    const { optional, kind } = schemaKind(prop.value);
    found.push({ name, optional, kind });
  }
  return found.length >= 2 ? found : undefined;
}
function compatible(left, right) {
  return left === right || left === "literal" && right === "string" || left === "string" && right === "literal";
}
function twins(typeFields, schema) {
  return typeFields.length === schema.length && typeFields.every((field) => {
    const match = schema.find((one) => one.name === field.name);
    return match !== undefined && match.optional === field.optional && compatible(field.kind, match.kind);
  });
}
function schemaName(call) {
  const { parent } = call;
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
function describeTwin(type, schema) {
  const subject = type === undefined ? "This object type" : `Type \`${type}\``;
  if (schema === undefined)
    return `${subject} repeats the fields of a Schema in this file. Derive it from the schema instead of writing both.`;
  return `${subject} repeats the fields of schema \`${schema}\` in this file. Derive it as \`typeof ${schema}.Type\` instead of writing both.`;
}
var rule2 = {
  meta: {
    type: "problem",
    docs: { description: "Derive an object type from the Schema it repeats instead of writing both" }
  },
  create(context) {
    const shapes = [];
    const schemas = [];
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
        const fields = schemaFields(node);
        if (fields !== undefined)
          schemas.push({ name: schemaName(node), fields });
      },
      "Program:exit"() {
        for (const shape of shapes) {
          const twin = schemas.find((schema) => twins(shape.fields, schema.fields));
          if (twin === undefined)
            continue;
          context.report({ node: shape.node, message: describeTwin(shapeName(shape.node), twin.name) });
        }
      }
    };
  }
};
var schema_twin_default = rule2;

// src/quality/data-shape/index.ts
var plugin = {
  meta: { name: "data-shape" },
  rules: {
    "readonly-collection-param": readonly_collection_param_default,
    "schema-twin": schema_twin_default
  }
};
var data_shape_default = plugin;
export {
  data_shape_default as default
};
