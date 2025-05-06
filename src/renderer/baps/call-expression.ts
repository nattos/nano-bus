import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator, BapGenerateContext, BapSubtreeValue } from '../bap-value';
import { bopShaderBinding } from '../gpu-binding/call-expression-rewrite';

export class BapCallExpressionVisitor extends BapVisitor {
  manual(
      {
        funcGen,
        argGens,
        typeArgGens,
        typeParameterNames,
      }:
      {
        funcGen?: BapSubtreeGenerator;
        argGens: Array<BapSubtreeGenerator|undefined>;
        typeArgGens?: Array<BapSubtreeGenerator|undefined>;
        typeParameterNames?: string[],
      }): BapSubtreeGenerator|undefined {
    const typeArgData = (typeParameterNames && typeArgGens) ? utils.zip(typeParameterNames, typeArgGens) : undefined;
    return {
      generateRead: (context: BapGenerateContext) => {
        let funcValue = funcGen?.generateRead(context, { allowTypeParameters: true });
        if (funcValue?.type === 'function') {
          const argValues = argGens.map(gen => gen?.generateRead(context));
          const typeArgValues = typeArgData?.map<BapSubtreeValue>(([ name, arg ]) => {
            return arg?.generateRead(context) ?? { type: 'error' };
          }) ?? [];
          const typeArgSpecs = typeArgValues.map(value => {
            if (value.type === 'type') {
              return value.typeGen.generate(context) ?? this.types.errorType;
            }
            return this.types.errorType;
          });
          funcValue = funcValue.resolve(argValues, typeArgSpecs);
        }
        return {
          // TODO: CACHE THIS!
          type: 'cached',
          typeSpec: funcValue?.typeSpec,
          writeIntoExpression: (prepare) => {
            return funcValue?.writeIntoExpression?.(prepare);
          },
        };
      },
    };
  }
  impl(node: ts.CallExpression): BapSubtreeGenerator|undefined {
    const shaderGen = bopShaderBinding.bind(this)(node);
    if (shaderGen) {
      return shaderGen;
    }

    const candidatesOutArray: ts.Signature[] = [];
    const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments.length);
    if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
      return;
    }
    // console.log(this.tc.signatureToString(functionSignature));

    const instantatedFromSignature = (functionSignature as any)?.target as ts.Signature|undefined;
    const typeParameterNames = instantatedFromSignature?.typeParameters?.map(t => t.symbol.getName());

    const funcGen = this.child(node.expression);
    const argGens = node.arguments.map(arg => this.child(arg));
    const typeArgGens = node.typeArguments?.map(typeArg => this.child(typeArg));
    return this.manual({ funcGen, argGens, typeArgGens, typeParameterNames });
  }
}
