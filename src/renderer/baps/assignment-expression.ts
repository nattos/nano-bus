import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapCachedValue, BapSubtreeGenerator, BapWriteIntoExpressionFunc } from '../bap-value';
import { CodeExpressionWriter, CodeVariable } from "../code-writer/code-writer";
import { BapIdentifierPrefix } from "../bap-constants";
import { BapGpuKernelScope } from "../bap-scope";

export class BapAssignmentExpressionVisitor extends BapVisitor {
  manual({
    refGen,
    valueGen,
    debugLoc,
  }: {
    refGen: BapSubtreeGenerator|undefined;
    valueGen: BapSubtreeGenerator|undefined;
    debugLoc?: ts.Node;
  }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        if (!this.verifyNotNulllike(refGen?.generateWrite, `Left hand side of assignment is not assignable.`)) {
          return { type: 'error' };
        }
        const basics = this.types.basic(context);
        const assignRefValue = refGen?.generateRead(context)
        const assignTypeSpec = assignRefValue.typeSpec;
        const value = valueGen?.generateRead(context, { willCoerceTo: assignTypeSpec });

        let debugValue: BapWriteIntoExpressionFunc|undefined;
        if (debugLoc && context.scope.resolvedGpu?.kernel !== BapGpuKernelScope.Vertex) {
          const lineNumber = this.getNodeLineNumber(debugLoc);
          let readValue: BapCachedValue|undefined = undefined;
          if (assignRefValue.type === 'cached') {
            readValue = assignRefValue;
          } else if (value?.type === 'cached') {
            readValue = value;
          }
          if (readValue && readValue.typeSpec && readValue.writeIntoExpression) {
            const readTypeSpec = readValue.typeSpec;
            let getters: Array<(expr: CodeExpressionWriter, inVar: CodeVariable) => void>|undefined;
            switch (readValue.typeSpec) {
              case basics.int:
                getters = [
                  (expr, inVar) => expr.writeCast(basics.int.codeTypeSpec).source.writeVariableReference(inVar),
                ];
                break;
              case basics.float:
                getters = [
                  (expr, inVar) => expr.writeVariableReference(inVar),
                ];
                break;
              case basics.float4:
                getters = [
                  (expr, inVar) => expr.writePropertyAccess(context.globalWriter.makeInternalToken('x')).source.writeVariableReference(inVar),
                  (expr, inVar) => expr.writePropertyAccess(context.globalWriter.makeInternalToken('y')).source.writeVariableReference(inVar),
                  (expr, inVar) => expr.writePropertyAccess(context.globalWriter.makeInternalToken('z')).source.writeVariableReference(inVar),
                  (expr, inVar) => expr.writePropertyAccess(context.globalWriter.makeInternalToken('w')).source.writeVariableReference(inVar),
                ];
                break;
            }
            if (getters && getters.length > 0) {
              debugValue = (prepare) => {
                const readWriter = readValue.writeIntoExpression!(prepare);
                const tmpVar = prepare.scope.allocateVariableIdentifier(readTypeSpec.codeTypeSpec, BapIdentifierPrefix.Local, 'debugOut');
                return (expr) => {
                  expr.discard();
                  readWriter?.(prepare.writeVariableDeclaration(tmpVar).initializer.writeExpression());
                  const funcCall = prepare.writeExpressionStatement().expr.writeStaticFunctionCall(context.globalWriter.makeInternalToken('BopLib::exportDebugOut'));
                  funcCall.addArg().writeLiteralInt(lineNumber);
                  funcCall.addArg().writeLiteralInt(getters.length);
                  for (let i = 0; i < 4; ++i) {
                    let getterFunc = getters.at(i);
                    getterFunc ??= (expr, inVar) => expr.writeLiteralFloat(0.0);
                    getterFunc(funcCall.addArg(), tmpVar);
                  }
                };
              };
            }
          }
        }

        if (!this.verifyNotNulllike(value, `Right hand side of assignment is not a value.`)) {
          return { type: 'error' };
        }
        const writerFunc = refGen?.generateWrite(context, value);
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            const writer = writerFunc?.(prepare);
            const debugValueWriter = debugValue?.(prepare);
            return (expr) => {
              expr.discard();
              writer?.(prepare);
              debugValueWriter?.(prepare.writeExpressionStatement().expr);
            };
          },
        };
      },
    };
  }

  impl(node: ts.BinaryExpression): BapSubtreeGenerator|undefined {
    const refGen = this.child(node.left);
    const valueGen = this.child(node.right);
    return this.manual({ refGen, valueGen, debugLoc: node });
  }
}
