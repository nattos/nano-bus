import { BapPrototypeScope, BapPrototypeMember } from '../bap-scope';
import { resolveBapFields } from '../bap-utils';
import { BapGenerateContext, BapTypeSpec, BapFields, BapSubtreeGenerator } from '../bap-value';
import { BapVisitor } from '../bap-visitor';
import { BapPropertyAccessExpressionVisitor } from '../baps/property-access-expression';
import { BapIdentifierPrefix } from '../bap-constants';
import { CodeAttributeKey, CodeVariable, CodeScopeType, CodeTypeSpec, CodeStatementWriter } from '../code-writer/code-writer';
import { BufferFiller } from './buffer-filler';
import { GpuBindings, GpuFixedBinding, GpuBinding } from './gpu-bindings';


/**
 * Walks the structure of `typeToBind` and moves blittable values into a
 * new blittable structure, and other types into shader uniforms.
 */
export function makeGpuBindings(this: BapVisitor, context: BapGenerateContext, typeToBind: BapTypeSpec, options?: { bindingLocation: CodeAttributeKey; }): GpuBindings {
  return makeGpuBindingsImpl.bind(this)(context, typeToBind, options);
}

function makeGpuBindingsImpl(this: BapVisitor, context: BapGenerateContext, typeToBind: BapTypeSpec, options?: { bindingLocation: CodeAttributeKey; }, visitedSet?: Set<BapTypeSpec>): GpuBindings {
  const bindingLocation = options?.bindingLocation ?? CodeAttributeKey.GpuBindLocation;
  const bopProcessor = this;
  const writer = context.globalWriter;
  const basics = this.types.basic(context);

  const thisVisitedSet = visitedSet ?? new Set<BapTypeSpec>();
  const pushVisitType = (t: BapTypeSpec) => {
    if (thisVisitedSet.has(t)) {
      this.logAssert(`Attempted to bind a recursive type [ ${Array.from(thisVisitedSet).map(t => t.debugName).join(' => ')} ]`);
      return false;
    }
    thisVisitedSet.add(t);
    return true;
  };
  const popVisitType = (t: BapTypeSpec) => {
    thisVisitedSet.delete(t);
  };
  if (!pushVisitType(typeToBind)) {
    return { bindings: [] };
  }

  interface PathPart {
    identifier: string;
    bopType: BapTypeSpec;
  }
  interface CopyField {
    // type: 'int'|'float';
    copyAsType: BapTypeSpec;
    path: PathPart[];
    marshalStructField?: CodeVariable;
    forBindArray?: {
      entry: BindArray;
      field: keyof BindArray['marshalStructFields'];
    };
  }
  interface BindArray {
    elementBinding: GpuFixedBinding;
    userType: BapTypeSpec;
    path: PathPart[];
    marshalStructFields: {
      length?: CodeVariable;
    };
  }
  interface BindTexture {
    path: PathPart[];
  }

  const collectedCopyFields: Array<CopyField> = [];
  const collectedArrays: Array<BindArray> = [];
  const collectedTextures: Array<BindTexture> = [];

  const typeFields = resolveBapFields(typeToBind, context);
  const visitRec = (subpath: PathPart[], fields: BapFields) => {
    for (const field of fields) {
      const fieldIdentifier = field.identifier;
      const fieldSubpath = subpath.concat({ identifier: fieldIdentifier, bopType: field.type });
      if (basics.copyMarshallableSet.has(field.type)) {
        collectedCopyFields.push({
          path: fieldSubpath,
          copyAsType: field.type,
        });
      } else if (field.type === basics.Texture) {
        const bindArray: BindTexture = {
          path: fieldSubpath,
        };
        collectedTextures.push(bindArray);
      } else if (field.type.prototypeScope.arrayOfType) {
        const arrayOfType = field.type.prototypeScope.arrayOfType;
        // console.log(arrayOfType);
        const elementBindings = makeGpuBindingsImpl.bind(this)(context, arrayOfType, options, thisVisitedSet);
        // console.log(elementBindings);
        const elementBinding = elementBindings.bindings.find(b => b.type === 'fixed');
        if (elementBindings.bindings.length !== 1 || elementBinding?.type !== 'fixed') {
          this.logAssert(`Cannot bind array of type ${arrayOfType.debugName} as it is not blittable.`);
          continue;
        }
        const bindArray: BindArray = {
          path: fieldSubpath,
          userType: arrayOfType,
          elementBinding: elementBinding,
          marshalStructFields: {},
        };
        collectedArrays.push(bindArray);
        collectedCopyFields.push({
          path: fieldSubpath.concat({ identifier: 'length', bopType: basics.int }),
          copyAsType: basics.int,
          forBindArray: {
            entry: bindArray,
            field: 'length',
          },
        });
      } else if (field.type.prototypeScope /* determine when internal types can be marshaled! */) {
        if (!pushVisitType(field.type)) {
          continue;
        }
        visitRec(fieldSubpath, resolveBapFields(field.type, context));
        popVisitType(field.type);
      }
    }
  };
  visitRec([], typeFields);
  popVisitType(typeToBind);

  const bindings: GpuBinding[] = [];
  if (collectedCopyFields.length > 0) {
    let byteLengthAcc = 0;
    collectedCopyFields.forEach(f => byteLengthAcc += f.copyAsType.libType?.marshalSize ?? 4);
    const byteLength = byteLengthAcc;

    const marshalStructIdentifier = writer.global.scope.allocateIdentifier(BapIdentifierPrefix.Struct, `${typeToBind.debugName}_gpuMarshal`);
    const marshalStructWriter = writer.global.writeStruct(marshalStructIdentifier);
    const marshalStructScope = writer.global.scope.createChildScope(CodeScopeType.Class);
    // const marshalStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
    marshalStructWriter.touchedByCpu = false;
    marshalStructWriter.touchedByGpu = true;
    const unmarshalFields: Array<{ marshaledVar: CodeVariable; type: BapTypeSpec; path: PathPart[]; }> = [];

    let fieldIndex = 0;
    for (const field of collectedCopyFields) {
      const bopType = field.copyAsType;
      const nameHint = `${fieldIndex}_${field.path.map(p => p.identifier).join('_')}`;
      // const rawBopVar = marshalStructBlock.mapIdentifier(`${fieldIndex}_${nameHint}`, bopType.storageType, bopType);
      const rawField = marshalStructScope.allocateVariableIdentifier(bopType.codeTypeSpec, BapIdentifierPrefix.Field, nameHint);
      // rawBopVar.result = rawField;
      marshalStructWriter.body.writeField(rawField.identifierToken, bopType.codeTypeSpec, { attribs: [{ key: bindingLocation, intValue: fieldIndex }] });
      unmarshalFields.push({ marshaledVar: rawField, type: bopType, path: field.path });
      field.marshalStructField = rawField;
      fieldIndex++;
    }

    const marshalStructCodeTypeSpec = CodeTypeSpec.fromStruct(marshalStructIdentifier);
    // const marshalStructType: BapTypeSpec = BopType.createPassByValue({
    //   debugName: marshalStructIdentifier.nameHint,
    //   valueType: CodeTypeSpec.fromStruct(marshalStructIdentifier),
    //   innerScope: marshalStructScope,
    //   innerBlock: marshalStructBlock,
    //   structOf: new BopStructType(marshalStructFields),
    // });
    const self = this;
    bindings.push({
      type: 'fixed',
      nameHint: collectedCopyFields.map(f => f.path.at(-1)?.identifier ?? 'unknown').join('_'),
      location: bindings.length,
      byteLength: byteLength,
      marshalStructCodeTypeSpec: marshalStructCodeTypeSpec,
      marshal(dataVar: CodeVariable, bufferFiller: BufferFiller, body: CodeStatementWriter): void {
        self.asParent(() => {
          let offset = 0;
          for (const field of collectedCopyFields) {
            let leafGen: BapSubtreeGenerator | undefined = {
              generateRead: () => {
                return {
                  type: 'cached',
                  typeSpec: typeToBind,
                  writeIntoExpression: () => {
                    return (expr) => {
                      expr.writeVariableReference(dataVar);
                    };
                  }
                };
              }
            };
            for (const part of field.path) {
              leafGen = new BapPropertyAccessExpressionVisitor().manual({ thisGen: leafGen, identifierName: part.identifier });
            }
            const leafValue = leafGen?.generateRead(context);
            const leafWriter = leafValue?.writeIntoExpression?.(body);
            const readExprLeaf = bufferFiller.writeCpu(field.copyAsType, offset, body);
            leafWriter?.(readExprLeaf);
            offset += field.copyAsType.libType?.marshalSize ?? 4;
          }
        });
      },
      unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void {
        const rootScope = intoContext;
        for (const field of unmarshalFields) {
          const proxyVar = body.scope.allocateVariableIdentifier(field.type.codeTypeSpec, BapIdentifierPrefix.Local, field.path.map(p => p.identifier).join('_'));
          body.writeVariableDeclaration(proxyVar)
            .initializer.writeExpression().writePropertyAccess(field.marshaledVar.identifierToken)
            .source.writeVariableReference(dataVar);

          let childScope = rootScope;
          let leafVar;
          for (let i = 0; i < field.path.length; ++i) {
            const part = field.path[i];
            const requiresShadow = i < field.path.length - 1;
            const fieldName = part.identifier;
            let fieldVar: BapPrototypeMember | undefined = childScope.resolveMember(fieldName);
            if (fieldVar) {
              if (requiresShadow) {
                const shadowType = fieldVar.genType.generate(context);
                if (!shadowType || !shadowType.isShadow) {
                  break;
                }
                childScope = shadowType.prototypeScope;
              }
            } else {
              const prototypeScope = new BapPrototypeScope();
              const staticScope = new BapPrototypeScope();
              const shadowType: BapTypeSpec = {
                prototypeScope: prototypeScope,
                staticScope: staticScope,
                typeParameters: [],
                codeTypeSpec: part.bopType.codeTypeSpec,
                isShadow: true,
                debugName: part.bopType.debugName + '_shadow',
              };
              fieldVar = {
                gen: (bindScope) => {
                  return ({
                    generateRead: () => ({
                      type: 'eval',
                      typeSpec: shadowType,
                    })
                  });
                },
                genType: { generate: () => { return shadowType; } },
                token: context.globalWriter.errorToken,
                isField: true,
              };
              childScope.declare(fieldName, fieldVar);
              childScope = prototypeScope;
            }
            if (requiresShadow && !fieldVar?.genType.generate(context)?.isShadow) {
              break;
            }
            leafVar = fieldVar;
          }
          if (leafVar) {
            leafVar.gen = (bindScope) => {
              return ({
                generateRead: () => ({
                  type: 'eval',
                  typeSpec: field.type,
                  writeIntoExpression: (prepare) => {
                    return (expr) => {
                      expr.writePropertyAccess(field.marshaledVar.identifierToken).source.writeVariableReference(dataVar);
                    };
                  },
                })
              });
            };
          }
        }
      },
    });
  }
  for (const binding of collectedArrays) {
    const self = this;

    // TODO: Finish conversion!
    // bindings.push({
    //   type: 'array',
    //   nameHint: binding.path.at(-1)?.identifier.nameHint ?? 'unknown',
    //   location: bindings.length,
    //   userType: binding.userType,
    //   marshal(dataVar: CodeVariable, body: CodeStatementWriter): { arrayVar: CodeVariable } {
    //     const extractedPropVar = body.scope.allocateVariableIdentifier(binding.elementBinding.marshalStructType.tempType, BopIdentifierPrefix.Local, `bindArray_${binding.path.at(-1)?.identifier.nameHint}`);
    //     let readExprLeaf = body.writeVariableDeclaration(extractedPropVar).initializer.writeExpression();
    //     for (let i = binding.path.length - 1; i >= 0; --i) {
    //       const pathPart = binding.path[i];
    //       const propAccess = readExprLeaf.writePropertyAccess(pathPart.identifier);
    //       readExprLeaf = propAccess.source;
    //     }
    //     readExprLeaf.writeVariableReference(dataVar);
    //     if (binding.userType.structOf && !binding.userType.structOf.marshalFunc) {
    //       const marshalFuncVar = writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, `marshal_${binding.userType.debugName}`)
    //       const marshalFunc = writer.global.writeFunction(marshalFuncVar.identifierToken);
    //       marshalFunc.touchedByCpu = true;
    //       binding.userType.structOf.marshalFunc = marshalFuncVar;
    //       binding.userType.structOf.marshalLength = binding.elementBinding.byteLength;
    //       const funcScope = writer.global.scope.createChildScope(CodeScopeType.Function);
    //       const valueVar = funcScope.allocateVariableIdentifier(binding.elementBinding.marshalStructType.codeTypeSpec, BopIdentifierPrefix.Local, 'value');
    //       marshalFunc.addParam(binding.elementBinding.marshalStructType.codeTypeSpec, valueVar.identifierToken);
    //       const bufferFillerVar = funcScope.allocateVariableIdentifier(basics.BufferFiller.codeTypeSpec, BopIdentifierPrefix.Local, 'bufferFiller');
    //       marshalFunc.addParam(basics.BufferFiller.codeTypeSpec, bufferFillerVar.identifierToken);
    //       const indexVar = funcScope.allocateVariableIdentifier(basics.int.codeTypeSpec, BopIdentifierPrefix.Local, 'index');
    //       marshalFunc.addParam(basics.int.codeTypeSpec, indexVar.identifierToken);
    //       const funcBody = marshalFunc.body;
    //       const bufferFiller = new BufferFiller(context, bufferFillerVar);
    //       const baseOffsetVar = funcBody.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'baseOffset');
    //       const baseOffset = funcBody.writeVariableDeclaration(baseOffsetVar).initializer.writeExpression().writeBinaryOperation(CodeBinaryOperator.Multiply);
    //       baseOffset.lhs.writeVariableReference(indexVar);
    //       baseOffset.rhs.writeLiteralInt(binding.elementBinding.byteLength);
    //       bufferFiller.baseOffsetVar = baseOffsetVar;
    //       binding.elementBinding.marshal(valueVar, bufferFiller, funcBody);
    //     }
    //     return { arrayVar: extractedPropVar };
    //   },
    //   unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoBopVar: BapScope): void {
    //     const rootBlock = intoBopVar.lookupBlockOverride ?? self.globalBlock.createChildBlock(CodeScopeType.Local);
    //     const fieldType = binding.userType;
    //     let childBlock = rootBlock;
    //     let leafVar;
    //     for (const part of binding.path) {
    //       const fieldName = part.identifier.nameHint;
    //       let fieldVar = childBlock.identifierMap.get(fieldName);
    //       if (!fieldVar) {
    //         fieldVar = childBlock.mapIdentifier(fieldName, part.bopType.tempType, part.bopType);
    //         fieldVar.requiresDirectAccess = true;
    //         fieldVar.lookupBlockOverride = childBlock.createChildBlock(CodeScopeType.Local);
    //       }
    //       childBlock = fieldVar.lookupBlockOverride!;
    //       leafVar = fieldVar;
    //     }
    //     if (leafVar) {
    //       // Arrays must be accessed directly, because WSGL doesn't have a way to create aliases currently.
    //       leafVar.requiresDirectAccess = true;
    //       leafVar.result = dataVar;
    //       {
    //         const propName = 'length';
    //         const propType = self.intType;
    //         const propCopy = binding.marshalStructFields[propName];
    //         if (self.verifyNotNulllike(propCopy, `${propName} was not bound correctly.`)) {
    //           const proxyVar = body.scope.allocateVariableIdentifier(propType.tempType, BopIdentifierPrefix.Local, binding.path.map(f => f.identifier.nameHint).concat(propName).join('_'));
    //           body.writeVariableDeclaration(proxyVar).initializer.writeExpression().writeVariableReference(propCopy);
    //           const lengthProp = leafVar.lookupBlockOverride!.mapIdentifier(propName, propType.tempType, propType, false);
    //           lengthProp.requiresDirectAccess = true;
    //           lengthProp.result = proxyVar;
    //         }
    //       }
    //     }
    //     intoBopVar.requiresDirectAccess = true;
    //     intoBopVar.lookupBlockOverride = rootBlock;
    //   },
    // });
  }
  return { bindings };
}
