import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapSubtreeGenerator, BapGenerateContext } from "../bap-value";
import { BapVisitor } from "../bap-visitor";
import { CodePrimitiveType, CodeUnaryOperator } from "../code-writer";

export class BapPrefixUnaryExpressionVisitor extends BapVisitor {
  impl(node: ts.PrefixUnaryExpression): BapSubtreeGenerator|undefined {
    const opType =
        // node.operator === ts.SyntaxKind.PlusPlusToken ? CodeUnaryOperator.PlusPlus :
        // node.operator === ts.SyntaxKind.MinusMinusToken ? CodeUnaryOperator.MinusMinus :
        node.operator === ts.SyntaxKind.PlusToken ? CodeUnaryOperator.Plus :
        node.operator === ts.SyntaxKind.MinusToken ? CodeUnaryOperator.Negate :
        node.operator === ts.SyntaxKind.TildeToken ? CodeUnaryOperator.BitwiseNegate :
        node.operator === ts.SyntaxKind.ExclamationToken ? CodeUnaryOperator.LogicalNot :
        undefined;
    if (!this.verifyNotNulllike(opType, `Unknown operator ${node.operator}.`)) {
      return;
    }

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

    // const opType =
    //     // node.operator === ts.SyntaxKind.PlusPlusToken ? CodeUnaryOperator.PlusPlus :
    //     // node.operator === ts.SyntaxKind.MinusMinusToken ? CodeUnaryOperator.MinusMinus :
    //     node.operator === ts.SyntaxKind.PlusToken ? CodeUnaryOperator.Plus :
    //     node.operator === ts.SyntaxKind.MinusToken ? CodeUnaryOperator.Negate :
    //     node.operator === ts.SyntaxKind.TildeToken ? CodeUnaryOperator.BitwiseNegate :
    //     node.operator === ts.SyntaxKind.ExclamationToken ? CodeUnaryOperator.LogicalNot :
    //     undefined;
    // if (!this.verifyNotNulllike(opType, `Unknown operator ${node.operator}.`)) {
    //   return;
    // }

    // const isLogicalOp =
    //     opType === CodeUnaryOperator.Negate ||
    //     false;

    // const opName = utils.findEnumName(CodeUnaryOperator, opType);
    // const customOperatorName = `operator${opName}`;

    // const lhs = this.visitChild(node.operand);
    // const lhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.operand), { allowWouldBeAny: true }));

    // let exprType: BopType;
    // let lhsType: BopType;
    // let customOperator: { bopVar: BopVariable, functionOf: BopFunctionType }|undefined = undefined;
    // const thisStage: BopStage = {
    //   getAuxTypeInference: () => {
    //     // TODO: Support operators with different type patterns.
    //     const lhsAuxType = lhs.getAuxTypeInference?.();
    //     const lhsCustomOperatorType = this.makeCustomOperatorType(lhsRawType, lhsAuxType);
    //     if (lhsCustomOperatorType) {
    //       const lhsCustomOperator = lhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
    //       const lhsOverloads = lhsCustomOperator?.bopType.functionOf?.overloads;
    //       if (lhsOverloads) {
    //         let overloads = lhsOverloads;
    //         const resolvedCustomOperator = this.resolveFunctionOverload(overloads, [ lhsCustomOperatorType ]);

    //         if (resolvedCustomOperator) {
    //           customOperator = { bopVar: lhsCustomOperator!, functionOf: resolvedCustomOperator };
    //           lhsType = resolvedCustomOperator.args[0].type;
    //           exprType = resolvedCustomOperator.returnType;
    //           return { bopType: resolvedCustomOperator.returnType };
    //         }
    //       }
    //     }

    //     if (isLogicalOp) {
    //       exprType = this.booleanType;
    //       lhsType = lhsCustomOperatorType ?? exprType;
    //       return {};
    //     }

    //     if (lhsAuxType) {
    //       const asInt = lhsAuxType?.numberType === BopInferredNumberType.Int;
    //       exprType = asInt ? this.intType : this.floatType;
    //     } else {
    //       exprType = this.resolveType(this.tc.getTypeAtLocation(node));
    //     }
    //     lhsType = exprType;
    //     return { numberType: exprType === this.intType ? BopInferredNumberType.Int : BopInferredNumberType.Float };
    //   },
    //   produceResult: () => {
    //     thisStage.getAuxTypeInference!();
    //     const lhsVar = this.writeCoersionFromExpr(lhs, lhsType, this.blockWriter);
    //     if (customOperator) {
    //       const resolvedFunc = { functionVar: customOperator.bopVar, thisVar: undefined, functionOf: customOperator.functionOf };
    //       const callBop = this.makeCallBop(node, () => resolvedFunc, [ lhsVar ]);
    //       if (!callBop) {
    //         return;
    //       }
    //       this.doProduceResult(callBop);
    //       return { expressionResult: this.readResult(callBop) };
    //     } else {
    //       const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType, opName);
    //       const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //       const op = ret.initializer.writeExpression().writeUnaryOperation(opType);
    //       op.value.writeVariableReference(lhsVar);
    //       return { expressionResult: outBopVar };
    //     }
    //   },
    // };
    // return thisStage;


  }
}
