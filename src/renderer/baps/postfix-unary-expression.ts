import ts from "typescript/lib/typescript";
import { BapSubtreeGenerator, BapGenerateContext } from "../bap-value";
import { BapVisitor } from "../bap-visitor";
import { CodeBinaryOperator, CodeTypeSpec } from "../code-writer/code-writer";
import { BapBinaryExpressionVisitor } from './binary-expression';
import { BapNumericLiteralVisitor } from './numeric-literal';
import { BapIdentifierPrefix } from '../bap-constants';

export class BapPostfixUnaryExpressionVisitor extends BapVisitor {
  impl(node: ts.PostfixUnaryExpression): BapSubtreeGenerator|undefined {
    const opType =
        node.operator === ts.SyntaxKind.PlusPlusToken ? CodeBinaryOperator.Add :
        node.operator === ts.SyntaxKind.MinusMinusToken ? CodeBinaryOperator.Subtract :
        undefined;
    if (!this.verifyNotNulllike(opType, `Unknown operator ${node.operator}.`)) {
      return;
    }
    return this.asAssign(node, opType);
  }

  private asAssign(node: ts.PostfixUnaryExpression, opType: CodeBinaryOperator): BapSubtreeGenerator|undefined {
    const lhs = this.child(node.operand);
    const rhs = new BapNumericLiteralVisitor().manual({ intValue: 1 });
    const assignGen = new BapBinaryExpressionVisitor().manualAssign({ lhs, rhs, opType: opType });
    return {
      generateRead: (context: BapGenerateContext) => {
        const prevalueValue = lhs?.generateRead(context);
        const assignValue = assignGen?.generateRead(context);
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          typeSpec: prevalueValue?.typeSpec,
          writeIntoExpression: (prepare) => {
            const prevalueWriter = prevalueValue?.writeIntoExpression?.(prepare);
            const tmpVar = prepare.scope.allocateVariableIdentifier(prevalueValue?.typeSpec?.codeTypeSpec ?? CodeTypeSpec.compileErrorType, BapIdentifierPrefix.Local, 'tmp');
            const tmpInit = prepare.writeVariableDeclaration(tmpVar);
            prevalueWriter?.(tmpInit.initializer.writeExpression());
            assignValue?.writeIntoExpression?.(prepare)?.(prepare.writeExpressionStatement().expr);
            return expr => {
              expr.writeVariableReference(tmpVar);
            };
          },
        };
      },
    };
  }
}
