import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator, BapSubtreeValue } from '../bap-value';
import { BapControlFlowScopeType } from '../bap-scope';

export class BapContinueStatementVisitor extends BapVisitor {
  impl(node: ts.ContinueStatement): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        const controlFlowScopes = context.scope.resolveControlFlowScopes(BapControlFlowScopeType.Loop);
        if (!this.verifyNotNulllike(controlFlowScopes, `Continue statement is not in a loop.`)) {
          return { type: 'error' };
        }
        const writers: Array<BapSubtreeValue|undefined> = [];
        for (const controlFlowScope of controlFlowScopes.slice(0, -1)) {
          writers.push(controlFlowScope.preContinue?.generateRead(context));
          writers.push(controlFlowScope.preFinally?.generateRead(context));
        }
        writers.push(controlFlowScopes.at(-1)?.preContinue?.generateRead(context));
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            for (const writer of writers) {
              writer?.writeIntoExpression?.(prepare);
            }
            prepare.writeContinueStatement();
            return undefined;
          },
        };
      },
    };
  }
}
