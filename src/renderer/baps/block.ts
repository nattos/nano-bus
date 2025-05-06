import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapSubtreeGenerator, BapGenerateContext } from '../bap-value';

export class BapBlockVisitor extends BapVisitor {
  impl(node: ts.Block): BapSubtreeGenerator|undefined {
    const stmts = node.statements.map(stmt => this.child(stmt));
    return {
      generateRead: (context: BapGenerateContext) => {
        const stmtValues = stmts.map(stmt => stmt?.generateRead(context));
        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            for (const stmtValue of stmtValues) {
              stmtValue?.writeIntoExpression?.(prepare)?.(prepare.writeExpressionStatement().expr);
            }
            return undefined;
          },
        };
      },
    };
  }
}
