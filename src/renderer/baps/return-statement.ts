import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
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
        let returnAssignWriter = returnAssignGen?.generateRead(context);
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            returnAssignWriter?.writeIntoExpression?.(prepare)?.(prepare.writeExpressionStatement().expr);
            for (const writer of writers) {
              writer?.writeIntoExpression?.(prepare);
            }
            prepare.writeBreakStatement();
            return undefined;
          },
        };
      },
    };
    // const valueBop = this.visitChildOrNull(node.expression);
    // return {
    //   produceResult: () => {
    //     if (valueBop) {
    //       // Coerce to return type.
    //       const returnType = this.scopeReturnType;
    //       const valueVar = this.writeCoersionFromExpr(valueBop, returnType, this.blockWriter);

    //       const ret = this.blockWriter.writeReturnStatement();
    //       ret.expr.writeVariableReference(valueVar);
    //     }
    //     return {};
    //   },
    // };
  }
}
