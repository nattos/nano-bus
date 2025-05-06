import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapSubtreeGenerator, BapGenerateContext } from "../bap-value";
import { BapVisitor } from "../bap-visitor";
import { CodeBinaryOperator, CodePrimitiveType, CodeUnaryOperator } from "../code-writer";
import { BapBinaryExpressionVisitor } from './binary-expression';
import { BapNumericLiteralVisitor } from './numeric-literal';

export class BapPrefixUnaryExpressionVisitor extends BapVisitor {
  impl(node: ts.PrefixUnaryExpression): BapSubtreeGenerator|undefined {
    const assignOpType =
        node.operator === ts.SyntaxKind.PlusPlusToken ? CodeBinaryOperator.Add :
        node.operator === ts.SyntaxKind.MinusMinusToken ? CodeBinaryOperator.Subtract :
        undefined;
    const opType =
        node.operator === ts.SyntaxKind.PlusToken ? CodeUnaryOperator.Plus :
        node.operator === ts.SyntaxKind.MinusToken ? CodeUnaryOperator.Negate :
        node.operator === ts.SyntaxKind.TildeToken ? CodeUnaryOperator.BitwiseNegate :
        node.operator === ts.SyntaxKind.ExclamationToken ? CodeUnaryOperator.LogicalNot :
        undefined;
    if (!assignOpType && !opType) {
      this.logAssert(`Unknown operator ${node.operator}.`);
      return;
    }
    if (assignOpType) {
      return this.asAssign(node, assignOpType);
    } else if (opType) {
      return this.asExpr(node, opType);
    }
  }

  private asExpr(node: ts.PrefixUnaryExpression, opType: CodeUnaryOperator): BapSubtreeGenerator|undefined {
    const isLogicalOp =
        opType === CodeUnaryOperator.Negate ||
        false;

    const opName = utils.findEnumName(CodeUnaryOperator, opType);
    const customOperatorName = `operator${opName}`;

    const lhs = this.child(node.operand);
    if (!lhs) {
      return;
    }
    return {
      generateRead: (context: BapGenerateContext) => {
        const lhsValue = lhs.generateRead(context);
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Int),
          writeIntoExpression: (prepare) => {
            const lhsWriter = lhsValue.writeIntoExpression?.(prepare);
            return expr => {
              const opExpr = expr.writeUnaryOperation(opType);
              lhsWriter?.(opExpr.value);
            };
          },
        };
      },
    };
  }

  private asAssign(node: ts.PrefixUnaryExpression, opType: CodeBinaryOperator): BapSubtreeGenerator|undefined {
    const lhs = this.child(node.operand);
    const rhs = new BapNumericLiteralVisitor().manual({ intValue: 1 });
    return new BapBinaryExpressionVisitor().manualAssign({ lhs, rhs, opType: opType });
  }
}
