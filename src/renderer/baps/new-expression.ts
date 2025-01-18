import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapSubtreeGenerator } from '../bap-value';

export class BapNewExpressionVisitor extends BapVisitor {
  impl(node: ts.NewExpression): BapSubtreeGenerator|undefined {
    // TODO: Resolve function expressions.
    if (!ts.isIdentifier(node.expression)) {
      this.logAssert(`Function expressions are not supported.`);
      return;
    }
    const identifier = node.expression.text;

    const candidatesOutArray: ts.Signature[] = [];
    const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments?.length);
    if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
      return;
    }
    // console.log(this.tc.signatureToString(functionSignature));

    // const type = this.resolveType(this.tc.getTypeAtLocation(node));
    // return {
    //   generateRead: (context: BapGenerateContext) => {
    //     let innerScope = context.scope;
    //     if (hasGenericTypeArgs) {
    //       innerScope = innerScope.makeChild(...);
    //     }
    //     const type: BapSubtreeValue|undefined = innerScope.resolve(identifier);
    //     if (!this.check(type?.type === 'type', `Expected a type for new.`)) {
    //       return { type: 'error' };
    //     }
    //     const func: BapSubtreeValue = type.scope.resolve('constructor');
    //     if (!this.check(func?.type === 'literal' && func.value.type === 'function', `No constructor found.`)) {
    //       return { type: 'error' };
    //     }
    //     const overload: BapSubtreeValue = func.value.function.resolveOverload(...);
    //     if (!this.verifyNotNulllike(overload, `Constructor overload not found.`)) {
    //       return { type: 'error' };
    //     }
    //     // Make cached getter in scope. ???
    //     return {
    //       type  : 'cached',
    //       aaa,
    //     }
    //   },
    // };
    // return this.makeCallBop(node, () => {
    //   // TODO: Support constructor overloads.
    //   const constructorRef = createBopReference('constructor', type.innerBlock);
    //   this.resolve(constructorRef);
    //   const functionOf = this.resolveFunctionOverload(constructorRef.resolvedRef?.bopType, functionSignature);
    //   if (!this.verifyNotNulllike(constructorRef.resolvedRef, `Constructor for ${type.debugName} is undefined.`) ||
    //       !this.verifyNotNulllike(functionOf, `Constructor for ${type.debugName} is undefined.`)) {
    //     return;
    //   }
    //   return { functionVar: constructorRef.resolvedRef, thisVar: undefined, functionOf };
    // }, node.arguments ?? []);
  }
}
