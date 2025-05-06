import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodePrimitiveType, CodeTypeSpec } from "../code-writer/code-writer";
import { BapIdentifierPrefix } from '../bap-constants';
import { BapSubtreeGenerator, BapSubtreeValue } from '../bap-value';

export class BapIfStatementVisitor extends BapVisitor {
  impl(node: ts.IfStatement): BapSubtreeGenerator|undefined {
    if (!node.expression) {
      // TODO: Control flow!!!
      return;
    }
    const cond = this.child(node.expression);
    const thenBlock = this.child(node.thenStatement);
    return {
      generateRead: (context) => {
        const condValue = cond?.generateRead(context) ?? { type: 'error' };
        const condVar: BapSubtreeValue = {
          type: 'cached',
          typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Bool),
          writeIntoExpression: (prepare) => {
            const condCodeVar = prepare.scope.allocateVariableIdentifier(CodeTypeSpec.boolType, BapIdentifierPrefix.Local, 'cond');
            const condCodeVarStmt = prepare.writeVariableDeclaration(condCodeVar);
            const condWriter = condValue.writeIntoExpression?.(prepare);
            condWriter?.(condCodeVarStmt.initializer.writeExpression());
            return (expr) => {
              expr.writeVariableReference(condCodeVar);
            };
          },
        };
        const branchContext = context.withChildScope({ cond: condVar });
        const thenValue = thenBlock?.generateRead(branchContext);
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            const condValueWriter = condValue.writeIntoExpression?.(prepare);
            const condExpr = prepare.writeConditional(1);
            condValueWriter?.(condExpr.branches[0].condWriter);
            const branchPrepare = condExpr.branches[0].blockWriter;
            const thenWriter = thenValue?.writeIntoExpression?.(branchPrepare);
            return undefined;
          },
        };
      },
    };
  }
}
