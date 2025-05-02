import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodePrimitiveType } from "../code-writer";
import { BapSubtreeGenerator } from '../bap-value';

export class BapNumericLiteralVisitor extends BapVisitor {
  manual({ intValue, floatValue }: { intValue?: number; floatValue?: number; }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context, options) => {
        const willCoerceToFloat = options?.willCoerceTo === this.types.basic(context).float;
        const anyIntValue = intValue ?? (Math.round(floatValue ?? 0) | 0);
        const anyFloatValue = floatValue ?? intValue ?? 0;
        const asInt = intValue !== undefined && !willCoerceToFloat;
        return {
          type: 'literal',
          typeSpec: this.types.primitiveTypeSpec(asInt ? CodePrimitiveType.Int : CodePrimitiveType.Bool),
          writeIntoExpression: () => {
            return expr => {
              if (asInt) {
                expr.writeLiteralInt(anyIntValue);
              } else {
                expr.writeLiteralFloat(anyFloatValue);
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
