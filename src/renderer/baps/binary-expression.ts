import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapSubtreeGenerator, BapGenerateContext, BapGenerateOptions } from "../bap-value";
import { BapVisitor } from "../bap-visitor";
import { CodeBinaryOperator, CodePrimitiveType } from "../code-writer/code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapAssignmentExpressionVisitor } from './assignment-expression';

export class BapBinaryExpressionVisitor extends BapVisitor {
  impl(node: ts.BinaryExpression): BapSubtreeGenerator|undefined {
    const assignOpType =
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? CodeBinaryOperator.Add :
        node.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken ? CodeBinaryOperator.Subtract :
        node.operatorToken.kind === ts.SyntaxKind.AsteriskEqualsToken ? CodeBinaryOperator.Multiply :
        node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken ? CodeBinaryOperator.Divide :
        node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ? CodeBinaryOperator.Power :
        node.operatorToken.kind === ts.SyntaxKind.PercentEqualsToken ? CodeBinaryOperator.Modulo :
        undefined;
    const opType =
        ts.isPlusToken(node.operatorToken) ? CodeBinaryOperator.Add :
        ts.isMinusToken(node.operatorToken) ? CodeBinaryOperator.Subtract :
        ts.isAsteriskToken(node.operatorToken) ? CodeBinaryOperator.Multiply :
        node.operatorToken.kind === ts.SyntaxKind.SlashToken ? CodeBinaryOperator.Divide :
        node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken ? CodeBinaryOperator.Power :
        node.operatorToken.kind === ts.SyntaxKind.PercentToken ? CodeBinaryOperator.Modulo :
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ? CodeBinaryOperator.Equals :
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? CodeBinaryOperator.Equals :
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? CodeBinaryOperator.NotEquals :
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ? CodeBinaryOperator.NotEquals :
        node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken ? CodeBinaryOperator.GreaterThan :
        node.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken ? CodeBinaryOperator.GreaterThanEquals :
        node.operatorToken.kind === ts.SyntaxKind.LessThanToken ? CodeBinaryOperator.LessThan :
        node.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken ? CodeBinaryOperator.LessThanEquals :
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? CodeBinaryOperator.LogicalOr :
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? CodeBinaryOperator.LogicalAnd :
        undefined;
    if (!assignOpType && !opType) {
      this.logAssert(`Unknown operator ${getNodeLabel(node.operatorToken)}.`);
      return;
    }
    const lhs = this.child(node.left);
    const rhs = this.child(node.right);
    if (assignOpType) {
      return this.manualAssign({ lhs, rhs, opType: assignOpType, debugLoc: node });
    } else if (opType) {
      return this.manual({ lhs, rhs, opType });
    }
  }

  private manual({lhs, rhs, opType}: { lhs?: BapSubtreeGenerator, rhs?: BapSubtreeGenerator, opType: CodeBinaryOperator }): BapSubtreeGenerator|undefined {
    const isLogicalOp =
        opType === CodeBinaryOperator.Equals ||
        opType === CodeBinaryOperator.NotEquals ||
        opType === CodeBinaryOperator.GreaterThan ||
        opType === CodeBinaryOperator.GreaterThanEquals ||
        opType === CodeBinaryOperator.LessThan ||
        opType === CodeBinaryOperator.LessThanEquals ||
        opType === CodeBinaryOperator.LogicalOr ||
        opType === CodeBinaryOperator.LogicalAnd ||
        false;

    const opName = utils.findEnumName(CodeBinaryOperator, opType);
    const customOperatorName = `operator${opName}`;
    if (!lhs || !rhs) {
      return;
    }
    return {
      generateRead: (context: BapGenerateContext, options?: BapGenerateOptions) => {
        const floatType = this.types.basic(context).float;
        const intType = this.types.basic(context).int;

        const prelhsValue = lhs.generateRead(context);
        const prerhsValue = rhs.generateRead(context);
        let lhsValue = prelhsValue;
        let rhsValue = prerhsValue;
        let resultType = intType;

        const willCoerceToInt = options?.willCoerceTo === intType;
        const willCoerceToFloat = options?.willCoerceTo === floatType;
        const willCoerce = willCoerceToInt || willCoerceToFloat;
        const anyValueInt = prelhsValue.typeSpec === intType || prerhsValue.typeSpec === intType;
        const anyValueFloat = prelhsValue.typeSpec === floatType || prerhsValue.typeSpec === floatType;
        const anyType = anyValueInt || anyValueFloat;
        // console.log(
        //   'options', options,
        //   'willCoerceToInt', willCoerceToInt,
        //   'willCoerceToFloat', willCoerceToFloat,
        //   'anyValueInt', anyValueInt,
        //   'anyValueFloat', anyValueFloat,
        // );
        if (willCoerce || anyType) {
          const asFloat = anyValueFloat || (!anyType && willCoerceToFloat);
          const asType = asFloat ? floatType : intType;
          lhsValue = lhs.generateRead(context, { willCoerceTo: asType });
          rhsValue = rhs.generateRead(context, { willCoerceTo: asType });
          resultType = asType;
        }
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          typeSpec: resultType,
          writeIntoExpression: (prepare) => {
            const lhsWriter = lhsValue.writeIntoExpression?.(prepare);
            const rhsWriter = rhsValue.writeIntoExpression?.(prepare);
            return expr => {
              const opExpr = expr.writeBinaryOperation(opType);
              lhsWriter?.(opExpr.lhs);
              rhsWriter?.(opExpr.rhs);
            };
          },
        };
      },
    };
  }

  manualAssign({lhs, rhs, opType, debugLoc}: {
    lhs?: BapSubtreeGenerator;
    rhs?: BapSubtreeGenerator;
    opType: CodeBinaryOperator;
    debugLoc?: ts.Node;
  }): BapSubtreeGenerator|undefined {
    const valueGen = this.manual({lhs, rhs, opType});
    return new BapAssignmentExpressionVisitor().manual({ refGen: lhs, valueGen, debugLoc });
  }
}
