import type { CreateRule, ESTree } from "@oxlint/plugins";

function unwrapped(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function isAstroProps(value: ESTree.Expression): boolean {
  if (value.type !== "MemberExpression" || value.computed) return false;
  const { object, property } = value;
  return (
    object.type === "Identifier" &&
    object.name === "Astro" &&
    property.type === "Identifier" &&
    property.name === "props"
  );
}

function isSignedNumber(value: ESTree.Expression): boolean {
  return (
    value.type === "UnaryExpression" &&
    (value.operator === "-" || value.operator === "+") &&
    value.argument.type === "Literal" &&
    typeof value.argument.value === "number"
  );
}

function isPlainValue(value: ESTree.PropertyKey, bound: ReadonlySet<string>): boolean {
  return value.type === "Literal" || (value.type === "Identifier" && bound.has(value.name));
}

function readsProps(expression: ESTree.Expression, bound: ReadonlySet<string>): boolean {
  const value = unwrapped(expression);
  if (value.type !== "MemberExpression") return value.type === "Identifier" && bound.has(value.name);
  if (value.computed && !isPlainValue(value.property, bound)) return false;
  return isAstroProps(value) || readsProps(value.object, bound);
}

function isPlainPattern(pattern: ESTree.BindingPattern | ESTree.BindingRestElement | null, bound: ReadonlySet<string>): boolean {
  return isPlainInOrder(pattern, bound, new Set(bound));
}

function isPlainInOrder(
  pattern: ESTree.BindingPattern | ESTree.BindingRestElement | null,
  bound: ReadonlySet<string>,
  seen: Set<string>,
): boolean {
  if (pattern === null) return true;
  if (pattern.type === "RestElement") return isPlainInOrder(pattern.argument, bound, seen);
  if (pattern.type === "AssignmentPattern") {
    return (isPlainValue(pattern.right, seen) || isSignedNumber(pattern.right)) && isPlainInOrder(pattern.left, bound, seen);
  }
  if (pattern.type === "ArrayPattern") return pattern.elements.every((element) => isPlainInOrder(element, bound, seen));
  if (pattern.type === "Identifier") {
    seen.add(pattern.name);
    return true;
  }
  return pattern.properties.every((property) =>
    property.type === "RestElement"
      ? isPlainInOrder(property.argument, bound, seen)
      : (!property.computed || isPlainValue(property.key, bound)) && isPlainInOrder(property.value, bound, seen),
  );
}

function isPropsRead(declarator: ESTree.VariableDeclarator, bound: ReadonlySet<string>): boolean {
  return declarator.init !== null && readsProps(declarator.init, bound) && isPlainPattern(declarator.id, bound);
}

function boundName(pattern: ESTree.BindingPattern | ESTree.BindingRestElement | null, found: Set<string>): void {
  if (pattern === null) return;
  if (pattern.type === "RestElement") boundName(pattern.argument, found);
  else if (pattern.type === "AssignmentPattern") boundName(pattern.left, found);
  else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) boundName(property.type === "Property" ? property.value : property.argument, found);
  } else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) boundName(element, found);
  } else found.add(pattern.name);
}

function isTypeDeclaration(statement: ESTree.Statement): boolean {
  const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  return declaration?.type === "TSInterfaceDeclaration" || declaration?.type === "TSTypeAliasDeclaration";
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow logic in .astro frontmatter and script blocks: only imports, props and markup, with client code loaded by a side-effect import such as import \"../client.ts\"" },
  },
  create(context) {
    if (!context.filename.endsWith(".astro")) return {};
    const bound = new Set<string>();
    return {
      Program(node) {
        for (const statement of node.body) {
          if (
            statement.type === "ImportDeclaration" ||
            statement.type === "EmptyStatement" ||
            (statement.type === "ExportNamedDeclaration" && statement.source !== null) ||
            isTypeDeclaration(statement)
          ) {
            continue;
          }
          if (
            statement.type === "VariableDeclaration" &&
            statement.declarations.length > 0 &&
            statement.declarations.every((declarator) => isPropsRead(declarator, bound))
          ) {
            for (const declarator of statement.declarations) boundName(declarator.id, bound);
            continue;
          }
          context.report({
            node: statement,
            message:
              "an .astro frontmatter or script block holds more than imports and props: move this statement into a .ts file and import it, so the .astro file holds only imports, props and markup; a script block loads client code with a side-effect import such as import \"../client.ts\"",
          });
        }
      },
    };
  },
};

export default rule;
