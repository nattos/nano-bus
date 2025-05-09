import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator, BapTypeGenerator } from '../bap-value';
import { BapConstructorSymbol } from '../bap-scope';
import { BapCallExpressionVisitor } from './call-expression';

export class BapResolveConstructorVisitor extends BapVisitor {
  manual(
      {
        typeGen,
      }:
      {
        typeGen?: BapTypeGenerator;
      }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        const type = typeGen?.generate(context);
        let funcValue = type?.prototypeScope.resolve(BapConstructorSymbol, context.scope)?.generateRead(context);
        return funcValue ?? { type: 'error' };
      },
    };
  }
}

export class BapNewExpressionVisitor extends BapVisitor {
  impl(node: ts.NewExpression): BapSubtreeGenerator|undefined {
    // TODO: Resolve function expressions.
    if (!ts.isIdentifier(node.expression)) {
      this.logAssert(`Function expressions are not supported.`);
      return;
    }
    const candidatesOutArray: ts.Signature[] = [];
    const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments?.length);
    if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
      return;
    }
    // console.log(this.tc.signatureToString(functionSignature));

    const typeGen = this.types.type(node);
    const funcGen = new BapResolveConstructorVisitor().manual({ typeGen });
    const argGens = node.arguments?.map(arg => this.child(arg)) ?? [];
    return new BapCallExpressionVisitor().manual({ funcGen, argGens });
  }
}
