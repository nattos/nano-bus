import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodePrimitiveType } from "../code-writer";
import { BapSubtreeGenerator } from '../bap-value';

export class BapNumericLiteralVisitor extends BapVisitor {
  manual({ intValue, floatValue }: { intValue?: number; floatValue?: number; }): BapSubtreeGenerator|undefined {
    const asInt = intValue !== undefined;
    return {
      generateRead: () => {
        return {
          type: 'literal',
          typeSpec: this.types.primitiveTypeSpec(asInt ? CodePrimitiveType.Int : CodePrimitiveType.Bool),
          writeIntoExpression: () => {
            return expr => {
              if (asInt) {
                expr.writeLiteralInt(intValue ?? Number.NaN);
              } else {
                expr.writeLiteralFloat(floatValue ?? Number.NaN);
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
  impl(node: ts.NumericLiteral): BapSubtreeGenerator|undefined {
    const parsedInt = utils.parseIntOr(node.text);
    const parsedFloat = utils.parseFloatOr(node.text);
    // TODO: Bad!!!
    const asInt = !node.getText(this.sourceRoot).includes('.') && parsedInt === parsedFloat;
    return this.manual(asInt ? { intValue: parsedInt } : { floatValue: parsedFloat });
  }
}
