import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapFunctionDeclarationVisitor } from './function-declaration';
import { BapSubtreeGenerator, BapGenerateContext, BapFunctionLiteral } from '../bap-value';

export class BapGlobalBlockVisitor extends BapVisitor {
  constructor(context: BapVisitorRootContext) {
    super(context);
  }

  visitSourceFile(node: ts.SourceFile): BapSubtreeGenerator|undefined {
    const oldParent = BapVisitor.currentParent;
    BapVisitor.currentParent = this;
    try {
      return this.implInner(node);
    } finally {
      BapVisitor.currentParent = oldParent;
    }
  }

  private implInner(node: ts.SourceFile): BapSubtreeGenerator|undefined {
    const stmts: Array<BapSubtreeGenerator|undefined> = [];
    for (const statement of node.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        // const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
      } else if (ts.isClassDeclaration(statement)) {
        // TODO:
        // if (!this.verifyNotNulllike(statement.name, `Anonymous classes not supported.`)) {
        //   return;
        // }
        // const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
      } else if (ts.isFunctionDeclaration(statement)) {
        stmts.push(new BapFunctionDeclarationVisitor().impl(statement));
      } else {
        this.logAssert(`Unsupported ${getNodeLabel(statement)} at global scope.`);
      }
    }

    return {
      generateRead: (context: BapGenerateContext) => {
        let lastFuncLiteral: BapFunctionLiteral|undefined;
        for (const stmt of stmts) {
          if (!stmt) {
            continue;
          }
          const result = stmt.generateRead(context);
          if (result.type === 'function') {
            lastFuncLiteral = result;
          }
        }
        return {
          type: 'literal',
          typeSpec: lastFuncLiteral?.typeSpec,
          writeIntoExpression: (prepare) => {
            if (lastFuncLiteral) {
              return lastFuncLiteral.resolve([], [])?.writeIntoExpression?.(prepare);
            }
          },
        };
        // const stmtValues = stmts.map(stmt => stmt?.generateRead(context));
        // return {
        //   type: 'statement',
        //   writeIntoExpression: (prepare) => {
        //     for (const stmtValue of stmtValues) {
        //       stmtValue?.writeIntoExpression?.(prepare)?.(prepare.writeExpressionStatement().expr);
        //     }
        //     return undefined;
        //   },
        // };
      },
    };
    // node.statements.forEach(this.visitChild.bind(this));
    // return {};
  }
}
