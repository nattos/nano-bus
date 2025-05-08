import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapIdentifier } from '../bap-scope';
import { BapSubtreeGenerator } from '../bap-value';

export class BapPropertyAccessExpressionVisitor extends BapVisitor {
  manual({ thisGen, identifierName }: { thisGen?: BapSubtreeGenerator; identifierName: BapIdentifier; }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context, options) => {
        const thisValue = thisGen?.generateRead(context);
        const thisContext = context.withChildScope({ bindScope: { thisValue: thisValue } });
        if (identifierName === 'sample') {
          console.log(identifierName);
        }
        return thisContext.scope.resolve(identifierName, { allowTypeParameters: options?.allowTypeParameters }) ?? { type: 'error' };
      },
      generateWrite: (context, value) => {
        const thisValue = thisGen?.generateRead(context);
        const thisContext = context.withChildScope({ bindScope: { thisValue: thisValue } });

        let writerFunc;
        // TODO: Do not traverse iterative control flow scopes!!!
        const oldValue = thisContext.scope.resolve(identifierName);
        if (oldValue?.type === 'cached' && oldValue.generateWrite) {
          // This is probably a property accessor.
          writerFunc = oldValue.generateWrite(value);
        } else {
          context.scope.assign(identifierName, value);
        }
        return writerFunc;
      },
    };
  }

  impl(node: ts.PropertyAccessExpression): BapSubtreeGenerator|undefined {
    const thisGen = this.child(node.expression);
    const identifierName = node.name.text;
    return this.manual({ thisGen, identifierName });
  }
}
