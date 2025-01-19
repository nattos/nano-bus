import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator } from '../bap-value';
import { CodePrimitiveType } from "../code-writer";

export class BapBooleanLiteralVisitor extends BapVisitor {
  manual({ value }: { value: boolean }): BapSubtreeGenerator|undefined {
    return {
      generateRead: () => {
        return {
          type: 'literal',
          typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Bool),
          writeIntoExpression: () => {
            return expr => {
              expr.writeLiteralBool(value);
            };
          },
        };
      },
    };
  }

  impl(node: ts.TrueLiteral): BapSubtreeGenerator|undefined;
  impl(node: ts.FalseLiteral): BapSubtreeGenerator|undefined;
  impl(node: ts.TrueLiteral|ts.FalseLiteral): BapSubtreeGenerator|undefined {
    const isTrue = node.kind === ts.SyntaxKind.TrueKeyword;
    return this.manual({ value: isTrue });
  }
}
