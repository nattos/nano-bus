import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapIdentifier } from '../bap-scope';
import { BapGenerateContext, BapSubtreeGenerator, BapTypeSpec } from '../bap-value';

export class BapTypeReferenceVisitor extends BapVisitor {
  manual({
        identifierName,
        typeArgGens,
        genericBaseType,
      }: {
        identifierName: BapIdentifier;
        typeArgGens?: Array<BapSubtreeGenerator|undefined>;
        genericBaseType: ts.Type;
      }): BapSubtreeGenerator|undefined {
    const typeParameters = (genericBaseType as any as ts.Signature).typeParameters;
    const typeParameterNames = typeParameters?.map(t => t.symbol.getName());
    const typeArgData = (typeParameterNames && typeArgGens) ? utils.zip(typeParameterNames, typeArgGens) : undefined;

    return {
      generateRead: (context) => {
        // console.log('resolving', identifierName);
        let innerScope = context.scope;
        let bindContext: BapGenerateContext|undefined;
        if (typeArgData) {
          const innerContext = context.withChildScope();
          bindContext = innerContext;
          innerScope = innerContext.scope;
          for (const [ name, arg ] of typeArgData) {
            const typeArgValue = arg?.generateRead(context) ?? { type: 'error' };
            innerContext.scope.declare(name, typeArgValue);
          }
        }
        let resolved = innerScope.resolve(identifierName, { isTypeLookup: true }) ?? { type: 'error' };
        if (bindContext && resolved.type === 'type' && typeArgData) {
          const boundContext = bindContext;
          const innerTypeGen = resolved.typeGen;
          resolved = {
            type: 'type',
            isGenericTypeParameter: false,
            typeGen: {
              generate(context: BapGenerateContext): BapTypeSpec|undefined {
                return innerTypeGen.generate(boundContext);
              },
            },
          };
        }
        return resolved;
      },
    };
  }

  impl(node: ts.TypeReferenceNode): BapSubtreeGenerator|undefined {
    const identifierName = node.typeName.getText();
    const typeArgGens = node.typeArguments?.map(typeArg => this.child(typeArg));

    const genericBaseType = this.tc.getTypeAtLocation(node.typeName);
    return this.manual({ identifierName, typeArgGens, genericBaseType });
  }
}
