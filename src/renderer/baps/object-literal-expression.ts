import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator, CodeTypeSpec } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapSubtreeGenerator } from '../bap-value';
import { BopIdentifierPrefix } from '../bop-data';

export class BapObjectLiteralExpressionVisitor extends BapVisitor {
  impl(node: ts.ObjectLiteralExpression): BapSubtreeGenerator|undefined {
    const initializers: Array<{ field: string, valueGen?: BapSubtreeGenerator }> = [];
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p)) {
        const field = p.name.getText();
        const valueGen = this.child(p.initializer);
        initializers.push({ field, valueGen });
      } else {
        this.logAssert(`Unknown object literal syntax.`);
        continue;
      }
    }

    const asTypeGen = this.types.type(node);
    // const storage = createStorage(asType);

    return {
      generateRead: (context) => {
        const asType = asTypeGen.generate(context);
        const valueValues = initializers.map(e => ({
          field: e.field,
          token: asType?.prototypeScope.resolveCodeToken(e.field),
          value: e.valueGen?.generateRead(context),
        }));
        return {
          type: 'literal',
          typeSpec: asType,
          writeIntoExpression: (prepare) => {
            const valueWriters = valueValues.map(e => ({ field: e.field, token: e.token, writer: e.value?.writeIntoExpression?.(prepare) }));
            const intoVar = prepare.scope.allocateVariableIdentifier(asType?.codeTypeSpec ?? CodeTypeSpec.compileErrorType, BopIdentifierPrefix.Local, 'tmp');
            const initializerExpr = prepare.writeVariableDeclaration(intoVar).initializer;
            for (const e of valueWriters) {
              if (!this.verifyNotNulllike(e.token, `Field ${e.field} not found.`)) {
                continue;
              }
              e.writer?.(initializerExpr.writeAssignStructField(e.token).value);
            }
            return expr => {
              expr.writeVariableReference(intoVar);
            };
          },
        };
      },
    };

    // const willCoerceFieldsTo = new Map<string, CoersionRef>();
    // const initializers: Array<{ field: string, valueBop: BopStage, propertyRef: () => BopReference }> = [];
    // for (const p of node.properties) {
    //   if (ts.isPropertyAssignment(p)) {
    //     const field = p.name.getText();
    //     const valueBop = this.visitChild(p.initializer);
    //     initializers.push({ field, valueBop, propertyRef: utils.lazy(() => createBopReference(field, asType.innerBlock)) });
    //     willCoerceFieldsTo.set(field, { assignedFromBop: valueBop });
    //   } else {
    //     this.logAssert(`Unknown object literal syntax.`);
    //     continue;
    //   }
    // }
    //
    // const asType = this.resolveType(this.tc.getTypeAtLocation(node), { willCoerceFieldsTo });
    // // const storage = createStorage(asType);

    // return {
    //   resolveIdentifiers: () => {
    //     initializers.forEach(e => this.resolve(e.propertyRef()));
    //   },
    //   // resolveStorage: () => {
    //   //   this.resolveStorage(storage);
    //   // },
    //   produceResult: () => {
    //     const initializerVars: Array<{ identifierToken: CodeNamedToken, valueVar: CodeVariable }> = [];
    //     for (const initializer of initializers) {
    //       const prop = initializer.propertyRef().resolvedRef;
    //       const propRef = prop?.result;
    //       if (!this.verifyNotNulllike(prop, `Property ${initializer.field} is undefined.`) ||
    //           !this.verifyNotNulllike(propRef, `Property ${initializer.field} is undefined.`)) {
    //         return;
    //       }
    //       initializerVars.push({ identifierToken: propRef.identifierToken, valueVar: this.writeCoersionFromExpr(initializer.valueBop, prop.bopType, this.blockWriter) });
    //     }

    //     const [outVar, outBopVar] = allocTmpOut(asType.tempType, asType, asType.debugName);
    //     const ret = this.blockWriter.writeVariableDeclaration(outVar);
    //     for (const initializer of initializerVars) {
    //       ret.initializer.writeAssignStructField(initializer.identifierToken).value.writeVariableReference(initializer.valueVar);
    //     }
    //     return { expressionResult: outBopVar };
    //   },
    // };
  }
}
