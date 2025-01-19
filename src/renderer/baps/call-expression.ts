import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator, BapGenerateContext } from '../bap-value';
import { BapNumericLiteralVisitor } from './numeric-literal';

export class BapCallExpressionVisitor extends BapVisitor {
  impl(node: ts.CallExpression): BapSubtreeGenerator|undefined {
    const func = this.child(node.expression);

    const argGens = node.arguments.map(arg => this.child(arg));

    return {
      generateRead: (context: BapGenerateContext) => {
        let funcValue = func?.generateRead(context);
        if (funcValue?.type === 'function') {
          const argValues = argGens.map(gen => gen?.generateRead(context));
          funcValue = funcValue.resolve(argValues, []);
        }
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          typeSpec: funcValue?.typeSpec,
          writeIntoExpression: (prepare) => {
            return funcValue?.writeIntoExpression?.(prepare);
          },
        };
      },
    };

    // const callingFuncConcreteImpl = this.currentFunctionConcreteImpl;
    // if (!this.verifyNotNulllike(callingFuncConcreteImpl, `Function calls from the global scope are not supported.`)) {
    //   return;
    // }

    // // Hacky special cases!!! These are necessary for now since specialized
    // // generics handling, like vararg expansions are not supported.
    // let specialHandling: BopStage|undefined;
    // for (const specialHandler of this.specialHandlers) {
    //   specialHandling = specialHandler(node);
    //   if (specialHandling) {
    //     break;
    //   }
    // }
    // if (specialHandling) {
    //   return specialHandling;
    // }

    // // TODO: Resolve function expressions.
    // const oldAsAssignableRef = this.asAssignableRef;
    // this.asAssignableRef = true;
    // const functionBop = this.visitChild(node.expression);
    // this.asAssignableRef = oldAsAssignableRef;

    // const candidatesOutArray: ts.Signature[] = [];
    // const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments.length);
    // if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
    //   return;
    // }
    // // console.log(this.tc.signatureToString(functionSignature));

    // let typeParameters: BopFields = [];
    // const instantatedFromSignature = (functionSignature as any)?.target as ts.Signature|undefined;
    // if (instantatedFromSignature?.typeParameters) {
    //   // Reverse map to extrapolate type parameters.
    //   const typeMapper = (((functionSignature as any).mapper) as tsTypeMapper|undefined);
    //   if (typeMapper) {
    //     typeParameters = instantatedFromSignature.typeParameters.map(t => utils.upcast({ identifier: t.symbol.name, type: this.resolveType(tsGetMappedType(t, typeMapper, this.tc)) }));
    //   }
    // }

    // let functionVar: BopVariable|undefined;
    // return this.makeCallBop(node, () => {
    //   const functionExprResult = this.readFullResult(functionBop);
    //   const functionRef = functionExprResult?.expressionResult;
    //   const thisRef = functionExprResult?.thisResult;
    //   if (!functionRef) {
    //     return;
    //   }
    //   const genericFunction = functionRef?.genericFunctionResult;
    //   if (genericFunction) {
    //     functionVar = this.instantiateGenericFunction(genericFunction, typeParameters);
    //   }
    //   functionVar ??= functionRef;
    //   // const functionOf = functionVar.bopType.functionOf;
    //   const functionOf = this.resolveFunctionOverload(functionVar.bopType, functionSignature);
    //   if (!this.verifyNotNulllike(functionOf, `Expression is not callable.`)) {
    //     return;
    //   }
    //   if (functionOf.isMethod && !this.verifyNotNulllike(thisRef?.result, `Cannot call instance method in a static context.`)) {
    //     return;
    //   }
    //   if (functionOf.concreteImpl) {
    //     functionOf.concreteImpl.referencedFrom.add(callingFuncConcreteImpl);
    //     callingFuncConcreteImpl.references.add(functionOf.concreteImpl);
    //   }
    //   return { functionVar: functionVar, thisVar: thisRef, functionOf };
    // }, node.arguments);
  }
}
