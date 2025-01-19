import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapSubtreeGenerator, BapGenerateContext } from "../bap-value";
import { BapVisitor } from "../bap-visitor";
import { CodeBinaryOperator, CodePrimitiveType } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";

export class BapBinaryExpressionVisitor extends BapVisitor {
  impl(node: ts.BinaryExpression): BapSubtreeGenerator|undefined {
    const opType =
        ts.isPlusToken(node.operatorToken) ? CodeBinaryOperator.Add :
        ts.isMinusToken(node.operatorToken) ? CodeBinaryOperator.Subtract :
        ts.isAsteriskToken(node.operatorToken) ? CodeBinaryOperator.Multiply :
        node.operatorToken.kind === ts.SyntaxKind.SlashToken ? CodeBinaryOperator.Divide :
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
    if (!this.verifyNotNulllike(opType, `Unknown operator ${getNodeLabel(node.operatorToken)}.`)) {
      return;
    }

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

    const lhs = this.child(node.left);
    const rhs = this.child(node.right);
    if (!lhs || !rhs) {
      return;
    }
    return {
      generateRead: (context: BapGenerateContext) => {
        const lhsValue = lhs.generateRead(context);
        const rhsValue = rhs.generateRead(context);
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Int),
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
    // const lhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.left), { allowWouldBeAny: true }));
    // const rhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.right), { allowWouldBeAny: true }));

    // let exprType: BopType;
    // let lhsType: BopType;
    // let rhsType: BopType;
    // let customOperator: { bopVar: BopVariable, functionOf: BopFunctionType }|undefined = undefined;
    // const thisStage: BopStage = {
    //   getAuxTypeInference: () => {
    //     // TODO: Support operators with different type patterns.
    //     const lhsAuxType = lhs.getAuxTypeInference?.();
    //     const rhsAuxType = rhs.getAuxTypeInference?.();

    //     const lhsCustomOperatorType = this.makeCustomOperatorType(lhsRawType, lhsAuxType);
    //     const rhsCustomOperatorType = this.makeCustomOperatorType(rhsRawType, rhsAuxType);

    //     if (lhsCustomOperatorType && rhsCustomOperatorType) {
    //       const lhsCustomOperator = lhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
    //       const rhsCustomOperator = rhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
    //       const lhsOverloads = lhsCustomOperator?.bopType.functionOf?.overloads;
    //       const rhsOverloads = rhsCustomOperator?.bopType.functionOf?.overloads;
    //       if (lhsOverloads || rhsOverloads) {
    //         let overloads;
    //         if (lhsOverloads && rhsOverloads) {
    //           overloads = lhsOverloads.concat(rhsOverloads);
    //         } else {
    //           overloads = lhsOverloads ?? rhsOverloads!;
    //         }
    //         const resolvedCustomOperator = this.resolveFunctionOverload(overloads, [ lhsCustomOperatorType, rhsCustomOperatorType ]);

    //         if (resolvedCustomOperator) {
    //           if (lhsOverloads?.includes(resolvedCustomOperator)) {
    //             customOperator = { bopVar: lhsCustomOperator!, functionOf: resolvedCustomOperator };
    //           } else {
    //             customOperator = { bopVar: rhsCustomOperator!, functionOf: resolvedCustomOperator };
    //           }
    //           lhsType = resolvedCustomOperator.args[0].type;
    //           rhsType = resolvedCustomOperator.args[1].type;
    //           exprType = resolvedCustomOperator.returnType;
    //           return { bopType: resolvedCustomOperator.returnType };
    //         }
    //       }
    //     }

    //     if (isLogicalOp) {
    //       exprType = this.booleanType;
    //       lhsType = lhsCustomOperatorType ?? exprType;
    //       rhsType = rhsCustomOperatorType ?? exprType;
    //       return {};
    //     }

    //     if (lhsAuxType || rhsAuxType) {
    //       const asInt = lhsAuxType?.numberType === BopInferredNumberType.Int && rhsAuxType?.numberType === BopInferredNumberType.Int;
    //       exprType = asInt ? this.intType : this.floatType;
    //     } else {
    //       exprType = this.resolveType(this.tc.getTypeAtLocation(node));
    //     }
    //     lhsType = exprType;
    //     rhsType = exprType;
    //     return { numberType: exprType === this.intType ? BopInferredNumberType.Int : BopInferredNumberType.Float };
    //   },
    //   produceResult: () => {
    //     thisStage.getAuxTypeInference!();
    //     const lhsVar = this.writeCoersionFromExpr(lhs, lhsType, this.blockWriter);
    //     const rhsVar = this.writeCoersionFromExpr(rhs, rhsType, this.blockWriter);
    //     if (customOperator) {
    //       const resolvedFunc = { functionVar: customOperator.bopVar, thisVar: undefined, functionOf: customOperator.functionOf };
    //       const callBop = this.makeCallBop(node, () => resolvedFunc, [ lhsVar, rhsVar ]);
    //       if (!callBop) {
    //         return;
    //       }
    //       this.doProduceResult(callBop);
    //       return { expressionResult: this.readResult(callBop) };
    //     } else {
    //       const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType, opName);
    //       const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //       const op = ret.initializer.writeExpression().writeBinaryOperation(opType);
    //       op.lhs.writeVariableReference(lhsVar);
    //       op.rhs.writeVariableReference(rhsVar);
    //       return { expressionResult: outBopVar };
    //     }
    //   },
    // };
    // return thisStage;
  }
}
