import type { CreateRule, ESTree } from "@oxlint/plugins";

type Kind = "string" | "number" | "boolean" | "array" | "object" | "record" | "literal" | "unknown" | "wild";

type Field = { readonly name: string; readonly optional: boolean; readonly kind: Kind };

type Shape = ESTree.TSTypeLiteral | ESTree.TSInterfaceBody;

const STRUCTS: ReadonlySet<string> = new Set(["Struct", "TaggedStruct", "Class"]);

const REFINEMENTS: ReadonlySet<string> = new Set(["check", "annotate"]);

const SCHEMA_KINDS: Readonly<Record<string, Kind>> = {
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
  Unknown: "unknown",
};

function keyName(key: ESTree.PropertyKey): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

function typeKind(type: ESTree.TSType | undefined): Kind {
  const value = type?.type === "TSTypeOperator" ? type.typeAnnotation : type;
  if (value === undefined) return "wild";
  if (value.type === "TSStringKeyword") return "string";
  if (value.type === "TSNumberKeyword") return "number";
  if (value.type === "TSBooleanKeyword") return "boolean";
  if (value.type === "TSArrayType") return "array";
  if (value.type === "TSTypeLiteral") return "object";
  if (value.type === "TSLiteralType") return "literal";
  if (value.type === "TSUnknownKeyword") return "unknown";
  if (value.type === "TSTypeReference") return referenceKind(value);
  if (value.type === "TSUnionType" && value.types.every((one) => one.type === "TSLiteralType")) return "literal";
  return "wild";
}

function referenceKind(value: ESTree.TSTypeReference): Kind {
  if (value.typeName.type !== "Identifier") return "wild";
  if (value.typeName.name === "Array" || value.typeName.name === "ReadonlyArray") return "array";
  if (value.typeName.name === "Record" || value.typeName.name === "ReadonlyRecord") return "record";
  return "wild";
}

function schemaCallName(node: ESTree.Expression | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "CallExpression") return schemaCallName(node.callee);
  if (node.type !== "MemberExpression") return undefined;
  const { object, property } = node;
  if (object.type !== "Identifier" || object.name !== "Schema" || property.type !== "Identifier") return undefined;
  return property.name;
}

function kindOf(name: string | undefined): Kind {
  return name === undefined ? "wild" : (SCHEMA_KINDS[name] ?? "wild");
}

function refinedBase(value: ESTree.CallExpression): ESTree.Expression | undefined {
  const { callee } = value;
  if (callee.type !== "MemberExpression" || callee.object.type === "Super") return undefined;
  if (callee.property.type !== "Identifier" || !REFINEMENTS.has(callee.property.name)) return undefined;
  return callee.object;
}

function schemaKind(value: ESTree.Expression | undefined): { readonly optional: boolean; readonly kind: Kind } {
  if (value !== undefined && value.type === "CallExpression") {
    const name = schemaCallName(value.callee);
    if (name === "optionalKey" || name === "optional") {
      const first: ESTree.Argument | undefined = value.arguments[0];
      const inner = first === undefined || first.type === "SpreadElement" ? undefined : first;
      return { optional: true, kind: schemaKind(inner).kind };
    }
    const base = refinedBase(value);
    if (base !== undefined) return schemaKind(base);
    return { optional: false, kind: kindOf(name) };
  }
  return { optional: false, kind: kindOf(schemaCallName(value)) };
}

function shapeFields(node: Shape): Field[] {
  const members = node.type === "TSTypeLiteral" ? node.members : node.body;
  const found: Field[] = [];
  for (const member of members) {
    if (member.type !== "TSPropertySignature") continue;
    const name = keyName(member.key);
    if (name === undefined) continue;
    found.push({ name, optional: member.optional, kind: typeKind(member.typeAnnotation?.typeAnnotation) });
  }
  return found;
}

function schemaFields(call: ESTree.CallExpression): Field[] | undefined {
  const { callee } = call;
  const inner = callee.type === "CallExpression" ? callee.callee : callee;
  if (inner.type !== "MemberExpression") return undefined;
  const { object, property } = inner;
  if (object.type !== "Identifier" || object.name !== "Schema" || property.type !== "Identifier" || !STRUCTS.has(property.name)) {
    return undefined;
  }
  const fields = call.arguments.find((one): one is ESTree.ObjectExpression => one.type === "ObjectExpression");
  if (fields === undefined) return undefined;
  const found: Field[] = property.name === "TaggedStruct" ? [{ name: "_tag", optional: false, kind: "literal" }] : [];
  for (const prop of fields.properties) {
    if (prop.type !== "Property" || prop.computed) continue;
    const name = keyName(prop.key);
    if (name === undefined) continue;
    const { optional, kind } = schemaKind(prop.value);
    found.push({ name, optional, kind });
  }
  return found.length >= 2 ? found : undefined;
}

function twins(typeFields: readonly Field[], schema: readonly Field[]): boolean {
  return (
    typeFields.length === schema.length &&
    typeFields.every((field) => {
      const match = schema.find((one) => one.name === field.name);
      return match !== undefined && match.optional === field.optional && field.kind === match.kind;
    })
  );
}

function schemaName(call: ESTree.CallExpression): string | undefined {
  const { parent } = call;
  if (parent.type !== "VariableDeclarator" || parent.id.type !== "Identifier") return undefined;
  return parent.id.name;
}

function shapeName(node: Shape): string | undefined {
  const { parent } = node;
  if (parent.type !== "TSTypeAliasDeclaration" && parent.type !== "TSInterfaceDeclaration") return undefined;
  return parent.id.name;
}

function describeTwin(type: string | undefined, schema: string | undefined): string {
  const subject = type === undefined ? "This object type" : `Type \`${type}\``;
  if (schema === undefined) return `${subject} repeats the fields of a Schema in this file. Derive it from the schema instead of writing both.`;
  return `${subject} repeats the fields of schema \`${schema}\` in this file. Derive it as \`typeof ${schema}.Type\` instead of writing both.`;
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Derive an object type from the Schema it repeats instead of writing both" },
  },
  create(context) {
    const shapes: { readonly node: Shape; readonly fields: readonly Field[] }[] = [];
    const schemas: { readonly name: string | undefined; readonly fields: readonly Field[] }[] = [];

    const collect = (node: Shape): void => {
      if (node.parent.type === "TSInterfaceDeclaration" && node.parent.extends.length > 0) return;
      const fields = shapeFields(node);
      if (fields.length >= 2) shapes.push({ node, fields });
    };

    return {
      TSTypeLiteral: collect,
      TSInterfaceBody: collect,
      CallExpression(node) {
        const fields = schemaFields(node);
        if (fields !== undefined) schemas.push({ name: schemaName(node), fields });
      },
      "Program:exit"() {
        for (const shape of shapes) {
          const twin = schemas.find((schema) => twins(shape.fields, schema.fields));
          if (twin === undefined) continue;
          context.report({ node: shape.node, message: describeTwin(shapeName(shape.node), twin.name) });
        }
      },
    };
  },
};

export default rule;
