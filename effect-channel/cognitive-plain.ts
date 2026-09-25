import {
  CALL_TYPES,
  CONTROL_TYPES,
  FUNCTION_TYPES,
  LOOP_TYPES,
  PLAIN_A_TYPES,
  PLAIN_B_TYPES,
  PLAIN_C_TYPES,
} from "./cognitive-nodes.ts";
import type {
  CallLike,
  Control,
  FunctionKind,
  Loop,
  PlainA,
  PlainB,
  PlainC,
  SyntaxNode,
} from "./cognitive-nodes.ts";

export function isControl(node: SyntaxNode): node is Control {
  return CONTROL_TYPES.includes(node.type);
}

export function isLoop(node: SyntaxNode): node is Loop {
  return LOOP_TYPES.includes(node.type);
}

export function isCall(node: SyntaxNode): node is CallLike {
  return CALL_TYPES.includes(node.type);
}

export function isFunction(node: SyntaxNode): node is FunctionKind {
  return FUNCTION_TYPES.includes(node.type);
}

export function isPlainA(node: SyntaxNode): node is PlainA {
  return PLAIN_A_TYPES.includes(node.type);
}

export function isPlainB(node: SyntaxNode): node is PlainB {
  return PLAIN_B_TYPES.includes(node.type);
}

export function isPlainC(node: SyntaxNode): node is PlainC {
  return PLAIN_C_TYPES.includes(node.type);
}

function unreachable(_value: never): void {}

export function plainChildrenA(node: PlainA): readonly (SyntaxNode | null)[] {
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

export function plainChildrenB(node: PlainB): readonly (SyntaxNode | null)[] {
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

export function plainChildrenC(node: PlainC): readonly (SyntaxNode | null)[] {
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
