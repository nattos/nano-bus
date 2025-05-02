import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapIdentifier } from '../bap-scope';
import { BapSubtreeGenerator } from '../bap-value';

export class BapElementAccessExpressionVisitor extends BapVisitor {
  impl(node: ts.ElementAccessExpression): BapSubtreeGenerator|undefined {
    const indexGen = this.child(node.argumentExpression);
    const fromGen = this.child(node.expression);
    // const resultType = this.resolveType(this.tc.getTypeAtLocation(node));

    return {
      generateRead: (context) => {
        const indexValue = indexGen?.generateRead(context);
        const fromValue = fromGen?.generateRead(context);
        return {
          type: 'cached',
          writeIntoExpression: (prepare) => {
            const indexWriter = indexValue?.writeIntoExpression?.(prepare);
            const fromWriter = fromValue?.writeIntoExpression?.(prepare);
            return (expr) => {
              const indexAccessExpr = expr.writeIndexAccess();
              indexWriter?.(indexAccessExpr.index);
              fromWriter?.(indexAccessExpr.source);
            };
          },
          generateWrite: () => {
            console.log('generateWrite');
            return undefined;
          },
        };
      },
      generateWrite: (context, value) => {
        const indexValue = indexGen?.generateRead(context);
        const fromValue = fromGen?.generateRead(context);

        return (prepare) => {
          const valueWriter = value.writeIntoExpression?.(prepare);
          const indexWriter = indexValue?.writeIntoExpression?.(prepare);
          const fromWriter = fromValue?.writeIntoExpression?.(prepare);
          return (block) => {
            const assignStmt = block.writeAssignmentStatement();
            const indexAccessExpr = assignStmt.ref.writeIndexAccess();
            indexWriter?.(indexAccessExpr.index);
            fromWriter?.(indexAccessExpr.source);
            valueWriter?.(assignStmt.value);
          };
        };
      },
    };

    // return {
    //   resolveIdentifiers: () => {
    //   },
    //   produceResult: () => {
    //     const indexBopVar = this.readResult(indexBop);
    //     const fromBopVar = this.readResult(fromBop);

    //     let outType = resultType.tempType;
    //     let isDirectAccess = false;
    //     if (asAssignableRef) {
    //       outType = outType.toReference();
    //       isDirectAccess = true;
    //     }

    //     const [accessVar, accessBopVar] = allocTmpOut(outType, resultType);
    //     const indexAccess = this.blockWriter.writeVariableDeclaration(accessVar).initializer.writeExpression().writeIndexAccess();
    //     indexAccess.source.writeVariableReference(fromBopVar.result!);
    //     indexAccess.index.writeVariableReference(indexBopVar.result!);
    //     accessBopVar.requiresDirectAccess = isDirectAccess;
    //     return {
    //       expressionResult: accessBopVar,
    //     };
    //   },
    //   isAssignableRef: asAssignableRef,
    // };



    // const thisGen = this.child(node.expression);
    // const identifierName = node.name.text;
    // return this.manual({ thisGen, identifierName });
  }
}
