import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator } from '../bap-value';

export class BapAssignmentExpressionVisitor extends BapVisitor {
  manual({
    refGen,
    valueGen,
  }: {
    refGen: BapSubtreeGenerator|undefined;
    valueGen: BapSubtreeGenerator|undefined;
  }): BapSubtreeGenerator|undefined {
    return {
      generateRead: (context) => {
        if (!this.verifyNotNulllike(refGen?.generateWrite, `Left hand side of assignment is not assignable.`)) {
          return { type: 'error' };
        }
        const assignTypeSpec = refGen?.generateRead(context).typeSpec;
        const value = valueGen?.generateRead(context, { willCoerceTo: assignTypeSpec });
        if (!this.verifyNotNulllike(value, `Right hand side of assignment is not a value.`)) {
          return { type: 'error' };
        }
        const writerFunc = refGen?.generateWrite(context, value);
        return {
          type: 'statement',
          writeIntoExpression: this.writeFuncToExpr(writerFunc),
        };
      },
    };
  }

  impl(node: ts.BinaryExpression): BapSubtreeGenerator|undefined {
    const refGen = this.child(node.left);
    const valueGen = this.child(node.right);
    return this.manual({ refGen, valueGen });
  }
}
