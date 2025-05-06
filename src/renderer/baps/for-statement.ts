import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator, BapSubtreeValue } from '../bap-value';
import { BapBreakBreakFlagSymbol, BapControlFlowScopeType } from '../bap-scope';
import { BapBooleanLiteralVisitor } from './boolean-literal';
import { BapVariableDeclarationVisitor } from './variable-declaration';
import { BapIdentifierExpressionVisitor } from "./identifier-expression";
import { BapAssignmentExpressionVisitor } from "./assignment-expression";
import { CodePrimitiveType, CodeTypeSpec } from "../code-writer/code-writer";

export class BapForStatementVisitor extends BapVisitor {
  impl(node: ts.ForStatement): BapSubtreeGenerator|undefined {
    if (!(node.initializer && node.condition && node.incrementor)) {
      this.logAssert(`Malformed for statement.`);
      return;
    }

    const breakBreakFlagDeclVisitor = new BapVariableDeclarationVisitor();
    const breakBreakFlagDeclGen = breakBreakFlagDeclVisitor.manual({
      newVars: [
        {
          identifier: BapBreakBreakFlagSymbol,
          type: this.types.primitiveType(CodePrimitiveType.Bool),
          initializer: new BapBooleanLiteralVisitor().manual({ value: false }),
        },
      ],
    });
    const breakBreakFlagReadGen = new BapIdentifierExpressionVisitor().manual({ identifierName: BapBreakBreakFlagSymbol });
    const setBreakBreakGen = new BapAssignmentExpressionVisitor().manual({
      refGen: breakBreakFlagReadGen,
      valueGen: new BapBooleanLiteralVisitor().manual({ value: true }),
    });

    const initGen = this.child(node.initializer);
    const condGen = this.child(node.condition);
    const updateGen = this.child(node.incrementor);
    const bodyGen = this.child(node.statement);
    return {
      generateRead: (context) => {
        const branchContext = context.withChildScope({ cond: { type: 'error' } });
        const bodyContext = branchContext.withChildScope({
          cond: { type: 'error' },
          controlFlowScope: {
            type: BapControlFlowScopeType.Loop,
            preContinue: this.bindGenContext(updateGen, context),
            preBreakBreak: this.bindGenContext(setBreakBreakGen, context),
          },
        });
        const breakBreakFlagDeclValue = breakBreakFlagDeclGen?.generateRead(branchContext);
        const initValue = initGen?.generateRead(branchContext);
        const condValue = condGen?.generateRead(branchContext);
        const updateValue = updateGen?.generateRead(branchContext);
        const bodyValue = bodyGen?.generateRead(bodyContext);

        const breakBreakFlagIdentifier = breakBreakFlagDeclVisitor.identifierInstance;
        const breakBreakFlagUsed = breakBreakFlagIdentifier && branchContext.scope.referencedInChildren.has(breakBreakFlagIdentifier);
        let breakBreakFlagValue: BapSubtreeValue|undefined = undefined;
        console.log(breakBreakFlagUsed, Array.from(branchContext.scope.referencedInChildren));
        if (breakBreakFlagUsed) {
          breakBreakFlagValue = breakBreakFlagReadGen?.generateRead(branchContext);
        }

        return {
          type: 'statement',
          writeIntoExpression: (prepare) => {
            // Prepare iterator variable.
            initValue?.writeIntoExpression?.(prepare);
            breakBreakFlagDeclValue?.writeIntoExpression?.(prepare);

            // Loop, breaking if the condition is true.
            const whileStmt = prepare.writeWhileLoop();
            whileStmt.condition.writeLiteralBool(true);
            const innerPrepare = whileStmt.body;
            const condBranchStmt = innerPrepare.writeConditional(1);
            condValue?.writeIntoExpression?.(innerPrepare)?.(condBranchStmt.branches[0].condWriter);
            condBranchStmt.branches[0].blockWriter.writeBreakStatement();

            // Run body.
            bodyValue?.writeIntoExpression?.(innerPrepare);

            // Run updater if continue and break were not encountered.
            updateValue?.writeIntoExpression?.(innerPrepare);

            if (breakBreakFlagValue) {
              const breakBreakIfStmt = prepare.writeConditional(1).branches[0];
              breakBreakFlagValue?.writeIntoExpression?.(prepare)?.(breakBreakIfStmt.condWriter);
              breakBreakIfStmt.blockWriter.writeBreakStatement();
            }
            return undefined;
          },
        };
      },
    };
  }
}
