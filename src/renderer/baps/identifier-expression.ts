import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapIdentifier, BapThisSymbol } from '../bap-scope';
import { BapSubtreeGenerator } from '../bap-value';

export class BapIdentifierExpressionVisitor extends BapVisitor {
  manual({ identifierName }: { identifierName: BapIdentifier; }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        return context.scope.resolve(identifierName) ?? { type: 'error' };
      },
      generateWrite: (context, value) => {
        let writerFunc;
        // TODO: Do not traverse iterative control flow scopes!!!
        const oldValue = context.scope.resolve(identifierName);
        if (oldValue?.type === 'cached' && oldValue.generateWrite) {
          writerFunc = oldValue.generateWrite(value);
        } else {
          context.scope.assign(identifierName, value);
        }
        return writerFunc;
      },
    };
  }

  impl(node: ts.Identifier): BapSubtreeGenerator|undefined;
  impl(node: ts.ThisExpression): BapSubtreeGenerator|undefined;
  impl(node: ts.Identifier|ts.ThisExpression): BapSubtreeGenerator|undefined {
    const identifierName = ts.isIdentifier(node) ? node.text : BapThisSymbol;
    return this.manual({ identifierName });
  }
}
