import ts from "typescript/lib/typescript";
import { BapGenerateContext, BapSubtreeGenerator } from "./bap-value";
import { BapBinaryExpressionVisitor } from "./baps/binary-expression";
import { BapBlockVisitor } from "./baps/block";
import { BapBooleanLiteralVisitor } from "./baps/boolean-literal";
import { BapCallExpressionVisitor } from "./baps/call-expression";
import { BapIdentifierExpressionVisitor } from "./baps/identifier-expression";
import { BapNewExpressionVisitor } from "./baps/new-expression";
import { BapNumericLiteralVisitor } from "./baps/numeric-literal";
import { BapReturnStatementVisitor } from "./baps/return-statement";
import { BapVariableDeclarationVisitor } from "./baps/variable-declaration";
import { CodeNamedToken, CodeScope, CodeScopeType, CodeStatementWriter, CodeStructWriter, CodeTypeSpec, CodeVariable, CodeWriter, CodeWriterPlatform } from "./code-writer/code-writer";
import { BapGlobalBlockVisitor } from "./baps/global-block";
import { BapVisitor, BapVisitorRootContext } from "./bap-visitor";
import { BapIfStatementVisitor } from "./baps/if-statement";
import { BapAssignmentExpressionVisitor } from "./baps/assignment-expression";
import { BapForStatementVisitor } from "./baps/for-statement";
import { BapBreakStatementVisitor } from "./baps/break-statement";
import { BapContinueStatementVisitor } from "./baps/continue-statement";
import { BapObjectLiteralExpressionVisitor } from "./baps/object-literal-expression";
import { BapPropertyAccessExpressionVisitor } from "./baps/property-access-expression";
import { BapPrefixUnaryExpressionVisitor } from "./baps/prefix-unary-expression";
import { BapPostfixUnaryExpressionVisitor } from "./baps/postfix-unary-expression";
import { BapLibLoader } from "./bap-lib-loader";
import { BapTypeReferenceVisitor } from "./baps/type-reference";
import { BapElementAccessExpressionVisitor } from "./baps/element-access-expression";
import { BapTypes } from "./bap-types";
import { BapIdentifierPrefix } from "./bap-constants";


class BapPassThroughVisitor<T extends ts.Node> extends BapVisitor {
  constructor(private readonly childNodeGetter: (node: T) => ts.Node) {
    super();
  }

  impl(node: T): BapSubtreeGenerator|undefined {
    return BapVisitor.visit(this.childNodeGetter(node));
  }
}

function makeBapPassThroughVisitor<T extends ts.Node>(childNodeGetter: (node: T) => ts.Node) {
  return () => { return new BapPassThroughVisitor(childNodeGetter); };
}

export function initBapProcessor() {
  BapVisitor.mapNodeType(ts.SyntaxKind.Block, BapBlockVisitor);
  BapVisitor.mapNodeTypeFunc(ts.SyntaxKind.ExpressionStatement, makeBapPassThroughVisitor((node: ts.ExpressionStatement) => node.expression));
  BapVisitor.mapNodeTypeFunc(ts.SyntaxKind.ParenthesizedExpression, makeBapPassThroughVisitor((node: ts.ParenthesizedExpression) => node.expression));
  BapVisitor.mapNodeType(ts.SyntaxKind.VariableStatement, BapVariableDeclarationVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.VariableDeclarationList, BapVariableDeclarationVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.BinaryExpression, BapAssignmentExpressionVisitor, (node) => node.operatorToken.kind === ts.SyntaxKind.EqualsToken);
  BapVisitor.mapNodeType(ts.SyntaxKind.ReturnStatement, BapReturnStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.IfStatement, BapIfStatementVisitor);
  // BapVisitor.mapNodeType(ts.SyntaxKind.ForOfStatement, BapForOfStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ForStatement, BapForStatementVisitor);
  // BapVisitor.mapNodeType(ts.SyntaxKind.WhileStatement, BapWhileStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.PropertyAccessExpression, BapPropertyAccessExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ElementAccessExpression, BapElementAccessExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.Identifier, BapIdentifierExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.TypeReference, BapTypeReferenceVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ThisKeyword, BapIdentifierExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.CallExpression, BapCallExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ObjectLiteralExpression, BapObjectLiteralExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.NewExpression, BapNewExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.PrefixUnaryExpression, BapPrefixUnaryExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.PostfixUnaryExpression, BapPostfixUnaryExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.BinaryExpression, BapBinaryExpressionVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.NumericLiteral, BapNumericLiteralVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.TrueKeyword, BapBooleanLiteralVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.FalseKeyword, BapBooleanLiteralVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ReturnStatement, BapReturnStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.BreakStatement, BapBreakStatementVisitor);
  BapVisitor.mapNodeType(ts.SyntaxKind.ContinueStatement, BapContinueStatementVisitor);
}

export function writeSourceNodeCode(
  node: ts.SourceFile,
  rootContext: BapVisitorRootContext,
  context: BapGenerateContext,
) {
  rootContext.types.debug = { debugContext: context };
  const libTypes = new BapLibLoader(rootContext).loadBopLib();
  for (const libType of libTypes) {
    context.scope.declare(libType.identifier, {
      type: 'type',
      isGenericTypeParameter: false,
      typeGen: libType.typeGen,
    });
    rootContext.types.addExternType(libType.identifier, libType.tsType, libType.typeGen);
  }

  new BapGlobalBlockVisitor(rootContext).visitSourceFile(node)?.generateRead(context);

  for (const exported of rootContext.moduleExports.functions) {
    exported.staticSignature = exported.signatureGenerator?.(context, []);
  }
}
