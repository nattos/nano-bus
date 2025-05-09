import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator } from '../bap-value';

export class BapElementAccessExpressionVisitor extends BapVisitor {
  impl(node: ts.ElementAccessExpression): BapSubtreeGenerator|undefined {
    const indexGen = this.child(node.argumentExpression);
    const fromGen = this.child(node.expression);

    return {
      generateRead: (context) => {
        const indexValue = indexGen?.generateRead(context);
        const fromValue = fromGen?.generateRead(context);
        return {
          type: 'cached',
          writeIntoExpression: (prepare) => {
            if (fromValue?.writeIndexAccessIntoExpression && indexValue) {
              return fromValue.writeIndexAccessIntoExpression(prepare, indexValue);
            }
            const indexWriter = indexValue?.writeIntoExpression?.(prepare);
            const fromWriter = fromValue?.writeIntoExpression?.(prepare);
            return (expr) => {
              const indexAccessExpr = expr.writeIndexAccess();
              indexWriter?.(indexAccessExpr.index);
              fromWriter?.(indexAccessExpr.source);
            };
          },
          generateWrite: () => {
            return undefined;
          },
        };
      },
      generateWrite: (context, value) => {
        const indexValue = indexGen?.generateRead(context);
        const fromValue = fromGen?.generateRead(context);

        return (prepare) => {
          if (fromValue?.writeIndexAccessWriteIntoExpression && indexValue) {
            return fromValue.writeIndexAccessWriteIntoExpression(prepare, indexValue, value);
          }
          const valueWriter = value.writeIntoExpression?.(prepare);
          const indexWriter = indexValue?.writeIntoExpression?.(prepare);
          const fromWriter = fromValue?.writeIntoExpression?.(prepare);
          return (block) => {
            const assignStmt = block.writeAssignmentStatement();
            const indexAccessExpr = assignStmt.ref.writeIndexAccess();
            indexWriter?.(indexAccessExpr.index);
            fromWriter?.(indexAccessExpr.source);
            valueWriter?.(assignStmt.value);
          };
        };
      },
    };
  }
}
