import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { getNodeLabel } from "../ts-helpers";
import { BapFunctionDeclarationVisitor } from './function-declaration';
import { BapSubtreeGenerator, BapGenerateContext, BapFunctionLiteral, BapTypeGenerator } from '../bap-value';

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
    const types: Array<{ identifier: string, typeGen: BapTypeGenerator }> = [];
    for (const statement of node.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        // const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
        types.push({ identifier: statement.name.text, typeGen: this.types.type(statement) });
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
        for (const { identifier, typeGen } of types) {
          context.scope.declare(identifier, {
            type: 'type',
            isGenericTypeParameter: false,
            typeGen: typeGen,
          });
        }

        for (const stmt of stmts) {
          if (!stmt) {
            continue;
          }
          const result = stmt.generateRead(context);
        }
        return {
          type: 'statement'
        };
      },
    };
  }
}
