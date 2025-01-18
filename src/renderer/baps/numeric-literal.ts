import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator, CodePrimitiveType } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapSubtreeGenerator } from '../bap-value';

export class BapNumericLiteralVisitor extends BapVisitor {
  impl(node: ts.NumericLiteral): BapSubtreeGenerator|undefined {
    const parsedInt = utils.parseIntOr(node.text);
    const parsedFloat = utils.parseFloatOr(node.text);
    // TODO: Bad!!!
    const asInt = !node.getText(this.sourceRoot).includes('.') && parsedInt === parsedFloat;
    return {
      generateRead: () => {
        return {
          type: 'literal',
          typeSpec: BapVisitor.primitiveTypeSpec(asInt ? CodePrimitiveType.Int : CodePrimitiveType.Bool),
          writeIntoExpression: () => {
            return expr => {
              if (asInt) {
                expr.writeLiteralInt(parsedInt ?? Number.NaN);
              } else {
                expr.writeLiteralFloat(parsedFloat ?? Number.NaN);
              }
            };
          },
        };
      },
    };
    // return {
    //   produceResult: () => {
    //     const numberType = asInt ? this.intType : this.floatType;
    //     const [outVar, outBopVar] = allocTmpOut(numberType.storageType, numberType, node.text);
    //     const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //     if (asInt) {
    //       ret.initializer.writeExpression().writeLiteralInt(parsedInt ?? Number.NaN);
    //     } else {
    //       ret.initializer.writeExpression().writeLiteralFloat(parsedFloat ?? Number.NaN);
    //     }
    //     return { expressionResult: outBopVar };
    //   },
    //   getAuxTypeInference: () => {
    //     return { numberType: asInt ? BopInferredNumberType.Int : BopInferredNumberType.Float };
    //   },
    // };
  }
}
