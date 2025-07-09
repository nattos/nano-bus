import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodePrimitiveType } from "../code-writer/code-writer";
import { BapControlFlowScopeType, BapReturnValueSymbol } from '../bap-scope';
import { BapSubtreeGenerator, BapFunctionLiteral, BapSubtreeValue, BapTypeSpec, BapGenerateContext, BapTypeGenerator } from '../bap-value';
import { BapVariableDeclarationVisitor } from './variable-declaration';
import { BapIdentifierExpressionVisitor } from './identifier-expression';
import { makeKernelGenerator } from '../gpu-binding/generate-kernel';
import { BapBasicTypeKey } from "../bap-types";
import { BapStaticField, BapStaticType } from "../bap-exports";

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
    const isExported = !!node.modifiers?.find(m => m.kind === ts.SyntaxKind.ExportKeyword);

    const parameterEntries: Array<{ identifier: string, type: ts.Type, isAutoField: boolean }> = [];
    const funcType = this.tc.getTypeAtLocation(node);
    const signature = this.tc.getSignaturesOfType(funcType, ts.SignatureKind.Call).at(0);
    if (!this.verifyNotNulllike(signature, `Function has unknown signature.`)) {
      return;
    }
    for (const param of signature.parameters) {
      parameterEntries.push({ identifier: param.name, type: this.tc.getTypeOfSymbol(param), isAutoField: false });
    }
    const returnType = signature.getReturnType();

    const returnTypeGen = this.types.type(returnType);
    const returnVarVisitor = new BapVariableDeclarationVisitor();
    const returnVarGen = returnVarVisitor.manual({ newVars: [
      {
        identifier: BapReturnValueSymbol,
        type: returnTypeGen,
      }
    ] });
    const returnValueGen = new BapIdentifierExpressionVisitor().manual({ identifierName: BapReturnValueSymbol })!;

    const generateGpuKernel = makeKernelGenerator.bind(this)(node);

    const result: BapSubtreeGenerator = {
      generateRead: (context) => {
        const body = this.child(funcBody);
        const funcLiteral: BapFunctionLiteral = {
          type: 'function',
          debugName: functionName ?? 'anonymous',
          typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Function),
          resolve: (args: BapSubtreeValue[], typeArgs: BapTypeSpec[]) => {
            // TODO: Perform overload resolution and generic template expansion.
            const childContext = context.withChildScope({ controlFlowScope: { type: BapControlFlowScopeType.Function } });
            for (let i = 0; i < parameterEntries.length; ++i) {
              const parameterSignature = parameterEntries[i];
              let argValue = args.at(i) ?? { type: 'error' };
              argValue = this.coerce(context, argValue, parameterSignature.type);
              // TODO: Sometimes pass copy!!!
              childContext.scope.declare(parameterSignature.identifier, argValue);
            }

            const returnVarWriter = returnVarGen?.generateRead(childContext);
            const returnTypeSpec = returnTypeGen.generate(childContext);
            const callWriter = body?.generateRead(childContext);

            return {
              type: 'literal',
              typeSpec: returnTypeSpec,
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
          generateGpuKernel: () => generateGpuKernel?.(context),
        };
        context.scope.declare(functionName, funcLiteral);
        return funcLiteral;
      },
    };

    if (isExported) {
      // TODO: Generics.
      const isGeneric = false;
      const signatureGenerator = (context: BapGenerateContext, typeArgs: BapTypeSpec[]) => {
        // TODO: Perform overload resolution and generic template expansion.
        const childContext = context.withChildScope({ controlFlowScope: { type: BapControlFlowScopeType.Function } });
        const parameters: BapStaticField[] = [];
        for (let i = 0; i < parameterEntries.length; ++i) {
          const parameterSignature = parameterEntries[i];
          const parameterType = toStaticType(this.types.type(parameterSignature.type), context);
          parameters.push({
            identifier: parameterSignature.identifier,
            type: parameterType ?? this.types.errorType,
          });
        }
        const returnTypeSpec = toStaticType(returnTypeGen, childContext);
        return {
          identifier: functionName,
          returnType: returnTypeSpec,
          parameters: parameters,
          isGeneric: isGeneric,
        };
      };
      this.rootContext.moduleExports.addFunction({ identifier: functionName, isGeneric, signatureGenerator, valueGenerator: result });
    }

    return result;
  }
}

function toStaticType(typeGen: BapTypeGenerator, context: BapGenerateContext): BapStaticType {
  const rootType = ((typeGen && 'generate' in typeGen) ? (typeGen?.generate(context)) : typeGen) ?? context.scope.rootContext.types.errorType;
  if (rootType.libType) {
    return {
      isLibType: true,
      isAnonymous: false,
      identifier: rootType.libType.identifier as BapBasicTypeKey,
    };
  }
  return {
    isLibType: false,
    isAnonymous: rootType.userCodeIdentifier === undefined,
    identifier: rootType.userCodeIdentifier ?? '<anonymous>',
    fields: rootType.prototypeScope.allFields.map(([key, member]) => ({
      identifier: member.userCodeIdentifier,
      type: toStaticType(member.genType, context)
    })),
  };
}
