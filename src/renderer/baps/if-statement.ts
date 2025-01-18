import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator, CodePrimitiveType, CodeTypeSpec, CodeVariable } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BopIdentifierPrefix } from '../bop-data';
import { BapSubtreeGenerator, BapSubtreeValue } from '../bap-value';

export class BapIfStatementVisitor extends BapVisitor {
  impl(node: ts.IfStatement): BapSubtreeGenerator|undefined {
    // const condBop = this.visitChild(node.expression);
    // const branches: BopBlock[] = [ this.visitInBlock(node.thenStatement, CodeScopeType.Local) ];
    // if (node.elseStatement) {
    //   branches.push(this.visitInBlock(node.elseStatement, CodeScopeType.Local));
    // }
    // return {
    //   produceResult: () => {
    //     const condVar = this.writeCoersionFromExpr(condBop, this.booleanType, this.blockWriter);
    //     const ret = this.blockWriter.writeConditional(branches.length);
    //     ret.branches[0].condWriter.writeVariableReference(condVar);
    //     this.writeBlock(branches[0], ret.branches[0].blockWriter);
    //     return {};
    //   },
    // };



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
          typeSpec: BapVisitor.primitiveTypeSpec(CodePrimitiveType.Bool),
          writeIntoExpression: (prepare) => {
            const condCodeVar = prepare.scope.allocateVariableIdentifier(CodeTypeSpec.boolType, BopIdentifierPrefix.Local, 'cond');
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
