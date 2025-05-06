import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapControlFlowScopeType, BapReturnValueSymbol } from '../bap-scope';
import { BapSubtreeGenerator, BapSubtreeValue } from '../bap-value';
import { BapAssignmentExpressionVisitor } from './assignment-expression';
import { BapIdentifierExpressionVisitor } from './identifier-expression';

export class BapReturnStatementVisitor extends BapVisitor {
  impl(node: ts.ReturnStatement): BapSubtreeGenerator|undefined {
    const valueGen = this.child(node.expression);
    let returnAssignGen: BapSubtreeGenerator|undefined;
    if (valueGen) {
      returnAssignGen = new BapAssignmentExpressionVisitor().manual({
        refGen: new BapIdentifierExpressionVisitor().manual({ identifierName: BapReturnValueSymbol }),
        valueGen: valueGen,
      });
    }

    return {
      generateRead: (context) => {
        const controlFlowScopes = context.scope.resolveControlFlowScopes(BapControlFlowScopeType.Function);
        if (!this.verifyNotNulllike(controlFlowScopes, `Return statement is not in a function.`)) {
          return { type: 'error' };
        }
        const writers: Array<BapSubtreeValue|undefined> = [];
        for (const controlFlowScope of controlFlowScopes) {
          writers.push(controlFlowScope.preBreak?.generateRead(context));
          writers.push(controlFlowScope.preBreakBreak?.generateRead(context));
          writers.push(controlFlowScope.preFinally?.generateRead(context));
        }
        const returnAssignValue = returnAssignGen?.generateRead(context);
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            const returnAssignWriter = returnAssignValue?.writeIntoExpression?.(prepare);
            for (const writer of writers) {
              writer?.writeIntoExpression?.(prepare);
            }
            return (expr) => {
              returnAssignWriter?.(expr);
              prepare.writeBreakStatement();
            };
          },
        };
      },
    };
  }
}
