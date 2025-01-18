import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator, BapSubtreeValue } from '../bap-value';
import { BapControlFlowScopeType } from '../bap-scope';

export class BapBreakStatementVisitor extends BapVisitor {
  impl(node: ts.BreakStatement): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        const controlFlowScopes = context.scope.resolveControlFlowScopes(BapControlFlowScopeType.Loop);
        if (!this.verifyNotNulllike(controlFlowScopes, `Break statement is not in a loop.`)) {
          return { type: 'error' };
        }
        const writers: Array<BapSubtreeValue|undefined> = [];
        for (const controlFlowScope of controlFlowScopes) {
          writers.push(controlFlowScope.preBreak?.generateRead(context));
          writers.push(controlFlowScope.preFinally?.generateRead(context));
        }
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            for (const writer of writers) {
              writer?.writeIntoExpression?.(prepare);
            }
            prepare.writeBreakStatement();
            return undefined;
          },
        };
      },
    };
  }
}
