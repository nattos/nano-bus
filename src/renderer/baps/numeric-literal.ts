import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodePrimitiveType, CodeTypeSpec } from "../code-writer/code-writer";
import { BapSubtreeGenerator, BapWriteIntoExpressionFunc } from '../bap-value';

export class BapNumericLiteralVisitor extends BapVisitor {
  manual({ intValue, floatValue, debugLoc }: {
    intValue?: number;
    floatValue?: number;
    debugLoc?: ts.Node;
  }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context, options) => {
        const basics = this.types.basic(context);
        const willCoerceToFloat = options?.willCoerceTo === basics.float;
        const anyIntValue = intValue ?? (Math.round(floatValue ?? 0) | 0);
        const anyFloatValue = floatValue ?? intValue ?? 0;
        const asInt = intValue !== undefined && !willCoerceToFloat;

        let debugRead: BapWriteIntoExpressionFunc|undefined;
        if (debugLoc) {
          const lineNumber = this.getNodeLineNumber(debugLoc);
          const debugInEntry = context.scope.rootContext.debugInOuts.allocateIn(context, { lineNumber, defaultValue: anyFloatValue });
          debugRead = (prepare) => {
            return (expr) => {
              if (asInt) {
                expr = expr.writeCast(CodeTypeSpec.intType).source;
              }
              const funcCall = expr
                  .writeStaticFunctionCall(context.globalWriter.makeInternalToken('BopLib::readDebugIn'));
              funcCall.addArg().writeLiteralInt(debugInEntry.entryIndex);
            };
          };
        }

        return {
          type: 'literal',
          typeSpec: asInt ? basics.int : basics.float,
          writeIntoExpression: (prepare) => {
            const debugReadWriter = debugRead?.(prepare);
            return expr => {
              if (debugReadWriter) {
                debugReadWriter(expr);
                return;
              }
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
  }
  impl(node: ts.NumericLiteral): BapSubtreeGenerator|undefined {
    const parsedInt = utils.parseIntOr(node.text);
    const parsedFloat = utils.parseFloatOr(node.text);
    // TODO: Bad!!!
    const asInt = !node.getText(this.sourceRoot).includes('.') && parsedInt === parsedFloat;
    return this.manual(asInt ? { intValue: parsedInt, debugLoc: node } : { floatValue: parsedFloat, debugLoc: node });
  }
}
