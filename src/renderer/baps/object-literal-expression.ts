import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodeTypeSpec } from "../code-writer";
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
  }
}
