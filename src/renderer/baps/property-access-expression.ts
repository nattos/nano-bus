import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapIdentifier } from '../bap-scope';
import { BapSubtreeGenerator } from '../bap-value';

export class BapPropertyAccessExpressionVisitor extends BapVisitor {
  manual({ thisGen, identifierName }: { thisGen?: BapSubtreeGenerator; identifierName: BapIdentifier; }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        const thisValue = thisGen?.generateRead(context);
        const thisContext = context.withChildScope({ bindScope: { thisValue: thisValue } });
        return thisContext.scope.resolve(identifierName) ?? { type: 'error' };
      },
      generateWrite: (context, value) => {
        const thisValue = thisGen?.generateRead(context);
        const thisContext = context.withChildScope({ bindScope: { thisValue: thisValue } });

        let writerFunc;
        // TODO: Do not traverse iterative control flow scopes!!!
        const oldValue = thisContext.scope.resolve(identifierName);
        if (oldValue?.type === 'cached' && oldValue.generateWrite) {
          // This is probably a property accessor.
          writerFunc = oldValue.generateWrite(value);
        } else {
          context.scope.assign(identifierName, value);
        }
        return writerFunc;
      },
    };
  }

  impl(node: ts.PropertyAccessExpression): BapSubtreeGenerator|undefined {
    const thisGen = this.child(node.expression);
    const identifierName = node.name.text;
    return this.manual({ thisGen, identifierName });
  }

  // const fromBop = this.visitChild(node.expression);
  // return {
  //   resolveIdentifiers: () => {
  //   },
  //   produceResult: () => {
  //     const fromBopVar = this.readResult(fromBop);
  //     const fromVar = fromBopVar.result!;
  //     const propertyRef = createBopReference(node.name.text, fromBopVar.lookupBlockOverride ?? fromBopVar.bopType.innerBlock);
  //     this.resolve(propertyRef);

  //     if (!this.verifyNotNulllike(propertyRef.resolvedRef, `Property ${propertyRef.identifier} is undefined.`)) {
  //       return;
  //     }
  //     const outBopType = propertyRef.resolvedRef.bopType;
  //     const isProperty = !!propertyRef.resolvedRef.propertyResult;
  //     let outType = propertyRef.resolvedRef.type;
  //     let isDirectAccess = false;
  //     if (asAssignableRef) {
  //       outType = outType.toReference();
  //       if (isProperty || outType.asPrimitive === CodePrimitiveType.Function) {
  //         isDirectAccess = true;
  //       }
  //     }
  //     if (propertyRef.resolvedRef.requiresDirectAccess) {
  //       isDirectAccess = true;
  //     }

  //     let outBopVar;
  //     if (isDirectAccess) {
  //       outBopVar = propertyRef.resolvedRef;
  //     } else {
  //       const propAccessor = propertyRef.resolvedRef.propertyResult;
  //       const propVar = propertyRef.resolvedRef.result;
  //       if (propAccessor) {
  //         // This is calling a getter property.
  //         const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.getter, thisVar: fromBopVar, functionOf: propAccessor.getter.bopType.functionOf!.overloads[0] }), []);
  //         if (!callBop) {
  //           return;
  //         }
  //         this.doProduceResult(callBop);
  //         const result = this.readResult(callBop);
  //         result.requiresDirectAccess = fromBopVar.requiresDirectAccess;
  //         return {
  //           expressionResult: result,
  //           thisResult: fromBopVar,
  //         };
  //       } else if (propVar) {
  //         const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType, node.name.text);
  //         outBopVar = outTmpBopVar;
  //         const ret = this.blockWriter.writeVariableDeclaration(outVar);
  //         let accessExpr = ret.initializer.writeExpression();
  //         if (fromBopVar.requiresDirectAccess) {
  //           accessExpr = accessExpr.writeDereferenceExpr().value;
  //         }
  //         let sourceExpr;
  //         if (fromBopVar.requiresDirectAccess) {
  //           sourceExpr = accessExpr.writePropertyReferenceAccess(propVar.identifierToken).source;
  //         } else {
  //           sourceExpr = accessExpr.writePropertyAccess(propVar.identifierToken).source;
  //         }
  //         sourceExpr.writeVariableReference(fromVar);
  //       } else {
  //         this.logAssert(`Property ${propertyRef.identifier} is undefined.`);
  //         return;
  //       }
  //       outBopVar.requiresDirectAccess = fromBopVar.requiresDirectAccess;
  //     }
  //     return {
  //       expressionResult: outBopVar,
  //       thisResult: fromBopVar,
  //     };
  //   },
  //   isAssignableRef: asAssignableRef && fromBop.isAssignableRef,
  // };

}
