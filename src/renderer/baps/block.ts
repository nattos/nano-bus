import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
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
              console.log(stmtValue);
              const stmtWriter = stmtValue?.writeIntoExpression?.(prepare);
              if (stmtWriter) {
                stmtWriter(prepare.writeExpressionStatement().expr);
              }
            }
            return undefined;
          },
        };
      },
    };
  }
}
