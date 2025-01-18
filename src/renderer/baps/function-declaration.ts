import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeBinaryOperator, CodePrimitiveType } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapControlFlowScopeType, BapReturnValueSymbol, BapThisSymbol } from '../bap-scope';
import { BapSubtreeGenerator, BapFunctionLiteral, BapSubtreeValue, BapTypeLiteral } from '../bap-value';
import { BapVariableDeclarationVisitor } from './variable-declaration';

export class BapFunctionDeclarationVisitor extends BapVisitor {
  impl(node: ts.FunctionDeclaration): BapSubtreeGenerator|undefined {
    if (!this.verifyNotNulllike(node.name, `Unsupported anonymous function at global scope.`)) {
      return;
    }
    if (!this.verifyNotNulllike(node.body, `Function at global scope must have a body.`)) {
      return;
    }
    const funcBody = node.body;
    const functionName = node.name.text;

    const parameterSignatures: Array<{ identifier: string, type: ts.Type, isAutoField: boolean }> = [];
    const funcType = this.tc.getTypeAtLocation(node);
    const signature = this.tc.getSignaturesOfType(funcType, ts.SignatureKind.Call).at(0);
    if (!this.verifyNotNulllike(signature, `Function has unknown signature.`)) {
      return;
    }
    for (const param of signature.parameters) {
      parameterSignatures.push({ identifier: param.name, type: this.tc.getTypeOfSymbol(param), isAutoField: false });
    }
    const returnType = signature.getReturnType();

    const returnVarVisitor = new BapVariableDeclarationVisitor();
    const returnVarGen = returnVarVisitor.manual({ newVars: [
      {
        identifier: BapReturnValueSymbol,
        type: this.type(returnType),
      }
    ] });

    return {
      generateRead: (context) => {
        const body = this.child(funcBody);
        const funcLiteral: BapFunctionLiteral = {
          type: 'function',
          typeSpec: BapVisitor.primitiveTypeSpec(CodePrimitiveType.Function),
          resolve: (args: BapSubtreeValue[], typeArgs: BapTypeLiteral[]) => {
            // TODO: Perform overload resolution and generic template expansion.
            // TODO: Insert args into context.
            const childContext = context.withChildScope({ controlFlowScope: { type: BapControlFlowScopeType.Function } });

            const returnVarWriter = returnVarGen?.generateRead(childContext);
            const callWriter = body?.generateRead(childContext);

            return {
              type: 'literal',
              typeSpec: returnVarWriter?.typeSpec,
              writeIntoExpression: (prepare) => {
                returnVarWriter?.writeIntoExpression?.(prepare);

                const innerBlock = prepare.writeWhileLoop();
                innerBlock.condition.writeLiteralBool(true);
                const innerPrepare = innerBlock.body;
                callWriter?.writeIntoExpression?.(innerPrepare);
                innerPrepare.writeBreakStatement();
                return childContext.scope.resolve(BapReturnValueSymbol)?.writeIntoExpression?.(prepare);
              },
            };
          },
        };
        context.scope.declare(functionName, funcLiteral);
        return funcLiteral;
      },
    };
  }
}
