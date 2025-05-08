import { BapPrototypeScope, BapPrototypeMember, BapGpuKernelScope } from '../bap-scope';
import { resolveBapFields } from '../bap-utils';
import { BapGenerateContext, BapTypeSpec, BapFields, BapSubtreeGenerator, BapSubtreeValue } from '../bap-value';
import { BapVisitor } from '../bap-visitor';
import { BapPropertyAccessExpressionVisitor } from '../baps/property-access-expression';
import { BapIdentifierPrefix } from '../bap-constants';
import { CodeAttributeKey, CodeVariable, CodeScopeType, CodeTypeSpec, CodeStatementWriter, CodeExpressionWriter, CodePrimitiveType, CodeBinaryOperator } from '../code-writer/code-writer';
import { BufferFiller } from './buffer-filler';
import { GpuBindings, GpuFixedBinding, GpuBinding } from './gpu-bindings';
import { BapAssignmentExpressionVisitor } from '../baps/assignment-expression';


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
  type HasMarshalStructFieldsEntry<T extends { marshalStructFields: { [k: string]: CodeVariable} }> = {
    entry: T;
    field: keyof T['marshalStructFields'];
  };
  interface CopyField {
    type: 'field';
    copyAsType: BapTypeSpec;
    path: PathPart[];
    marshalStructField?: CodeVariable;
    forBindArray?: HasMarshalStructFieldsEntry<BindArray>|HasMarshalStructFieldsEntry<BindTexture>;
  }
  interface BindArray {
    type: 'array';
    elementBinding: GpuFixedBinding;
    userType: BapTypeSpec;
    path: PathPart[];
    marshalStructFields: {
      length?: CodeVariable;
    };
  }
  interface BindTexture {
    type: 'texture';
    path: PathPart[];
    marshalStructFields: {
      size?: CodeVariable;
    };
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
          type: 'field',
          path: fieldSubpath,
          copyAsType: field.type,
        });
      } else if (field.type === basics.Texture) {
        const bindTexture: BindTexture = {
          type: 'texture',
          path: fieldSubpath,
          marshalStructFields: {},
        };
        collectedTextures.push(bindTexture);
        collectedCopyFields.push({
          type: 'field',
          path: fieldSubpath.concat({ identifier: 'size', bopType: basics.int2 }),
          copyAsType: basics.int2,
          forBindArray: {
            entry: bindTexture,
            field: 'size',
          },
        });
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
          type: 'array',
          path: fieldSubpath,
          userType: arrayOfType,
          elementBinding: elementBinding,
          marshalStructFields: {},
        };
        collectedArrays.push(bindArray);
        collectedCopyFields.push({
          type: 'field',
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

  const unmarshalProxyPath = (path: PathPart[], rootScope: BapPrototypeScope, valueGen: BapSubtreeGenerator) => {
    let childScope = rootScope;
    let leafVar;
    for (let i = 0; i < path.length; ++i) {
      const part = path[i];
      const requiresShadow = i < path.length - 1;
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
        return valueGen;
      };
    }
  };


  const bindings: GpuBinding[] = [];
  let nextBindingLocation = 0;
  // HACK!!! Forward fixed data variable to array bindings.
  let fixedDataVar: CodeVariable|undefined = undefined;
  if (collectedCopyFields.length > 0) {
    let byteLengthAcc = 0;
    collectedCopyFields.forEach(f => byteLengthAcc += f.copyAsType.libType?.marshalSize ?? 4);
    const byteLength = byteLengthAcc;

    const marshalStructIdentifier = writer.global.scope.allocateIdentifier(BapIdentifierPrefix.Struct, `${typeToBind.debugName}_gpuMarshal`);
    const marshalStructWriter = writer.global.writeStruct(marshalStructIdentifier);
    const marshalStructScope = writer.global.scope.createChildScope(CodeScopeType.Class);
    marshalStructWriter.touchedByCpu = false;
    marshalStructWriter.touchedByGpu = true;
    const unmarshalFields: Array<{ marshaledVar: CodeVariable; type: BapTypeSpec; path: PathPart[]; }> = [];

    let fieldIndex = 0;
    for (const field of collectedCopyFields) {
      const bopType = field.copyAsType;
      const nameHint = `${fieldIndex}_${field.path.map(p => p.identifier).join('_')}`;
      const rawField = marshalStructScope.allocateVariableIdentifier(bopType.codeTypeSpec, BapIdentifierPrefix.Field, nameHint);
      marshalStructWriter.body.writeField(rawField.identifierToken, bopType.codeTypeSpec, { attribs: [{ key: bindingLocation, intValue: fieldIndex }] });
      unmarshalFields.push({ marshaledVar: rawField, type: bopType, path: field.path });
      field.marshalStructField = rawField;

      if (field.forBindArray) {
        const entry = field.forBindArray.entry;
        (entry.marshalStructFields as any)[field.forBindArray.field] = rawField;
      }
      fieldIndex++;
    }

    const marshalStructCodeTypeSpec = CodeTypeSpec.fromStruct(marshalStructIdentifier);
    const self = this;

    bindings.push({
      type: 'fixed',
      nameHint: collectedCopyFields.map(f => f.path.at(-1)?.identifier ?? 'unknown').join('_'),
      location: nextBindingLocation++,
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
        fixedDataVar = dataVar;
        for (const field of unmarshalFields) {
          unmarshalProxyPath(field.path, intoContext, {
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
        }
      },
      copyIntoUserVar: (userVar: CodeVariable, body: CodeStatementWriter, dataVarGetter: (expr: CodeExpressionWriter) => void) => {
        self.asParent(() => {
          for (const field of collectedCopyFields) {
            let dataLeafGen: BapSubtreeGenerator | undefined = {
              generateRead: () => {
                return {
                  type: 'cached',
                  typeSpec: field.copyAsType,
                  writeIntoExpression: () => {
                    return (expr) => {
                      if (field.marshalStructField) {
                        dataVarGetter(expr.writePropertyAccess(field.marshalStructField.identifierToken).source);
                      }
                    };
                  }
                };
              }
            };
            let userLeafGen: BapSubtreeGenerator | undefined = {
              generateRead: () => {
                return {
                  type: 'cached',
                  typeSpec: typeToBind,
                  writeIntoExpression: () => {
                    return (expr) => {
                      expr.writeVariableReference(userVar);
                    };
                  }
                };
              }
            };
            for (const part of field.path) {
              userLeafGen = new BapPropertyAccessExpressionVisitor().manual({ thisGen: userLeafGen, identifierName: part.identifier });
            }
            const assignGen = new BapAssignmentExpressionVisitor().manual({ refGen: userLeafGen, valueGen: dataLeafGen });
            assignGen?.generateRead(context)?.writeIntoExpression?.(body)?.(body.writeExpressionStatement().expr);
          }
        });
      },
    });
  }
  for (const binding of collectedArrays) {
    const self = this;
    const arrayCodeTypeSpec = CodeTypeSpec.fromStruct(context.globalWriter.makeInternalToken(basics.Array.libType!.identifier));
    const marshalArrayCodeTypeSpec = arrayCodeTypeSpec.withTypeArgs([binding.elementBinding.marshalStructCodeTypeSpec]);

    bindings.push({
      type: 'array',
      nameHint: binding.path.at(-1)?.identifier ?? 'unknown',
      location: nextBindingLocation++,
      userType: binding.userType,
      marshalArrayCodeTypeSpec: marshalArrayCodeTypeSpec,
      marshal(dataVar: CodeVariable, body: CodeStatementWriter): { arrayVar: CodeVariable } {
        return self.asParent(() => {
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
          for (const part of binding.path) {
            leafGen = new BapPropertyAccessExpressionVisitor().manual({ thisGen: leafGen, identifierName: part.identifier });
          }
          const leafValue = leafGen?.generateRead(context);
          const leafWriter = leafValue?.writeIntoExpression?.(body);
          const extractedPropVar = body.scope.allocateVariableIdentifier(binding.elementBinding.marshalStructCodeTypeSpec, BapIdentifierPrefix.Local, `bindArray_${binding.path.at(-1)?.identifier}`);
          let readExprLeaf = body.writeVariableDeclaration(extractedPropVar).initializer.writeExpression();
          leafWriter?.(readExprLeaf);
          return { arrayVar: extractedPropVar };
        });
      },
      unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void {
        const debugName = binding.path.map(f => f.identifier).join('_');

        const prototypeScope = new BapPrototypeScope();
        const staticScope = new BapPrototypeScope();
        const shadowType: BapTypeSpec = {
          prototypeScope: prototypeScope,
          staticScope: staticScope,
          typeParameters: [],
          codeTypeSpec: binding.userType.codeTypeSpec,
          isShadow: true,
          debugName: binding.userType.debugName + '_shadow',
        };

        unmarshalProxyPath(binding.path, intoContext, {
          generateRead: () => ({
            type: 'eval',
            typeSpec: shadowType,
            writeIntoExpression: (prepare) => {
              return (expr) => {
                expr.writeVariableReference(dataVar);
              };
            },
            writeIndexAccessIntoExpression: (prepare, indexValue) => {
              const indexWriter = indexValue.writeIntoExpression?.(prepare);

              const dataVarGetter = (expr: CodeExpressionWriter) => {
                const accessExpr = expr.writeIndexAccess();
                indexWriter?.(accessExpr.index);
                accessExpr.source.writeVariableReference(dataVar);
              };
              const userVar = prepare.scope.allocateVariableIdentifier(binding.userType.codeTypeSpec, BapIdentifierPrefix.Field, debugName + '_access');
              const userInit = prepare.writeVariableDeclaration(userVar);
              binding.elementBinding.copyIntoUserVar(userVar, prepare, dataVarGetter);
              return (expr) => {
                expr.writeVariableReference(userVar);
              };
            },
          }),
        });

        const lengthVar = binding.marshalStructFields.length;
        if (lengthVar && fixedDataVar) {
          const thisFixedDataVar = fixedDataVar;
          prototypeScope.declare('length', {
            gen: (bindScope) => {
              return ({
                generateRead: () => ({
                  type: 'eval',
                  typeSpec: basics.int,
                  writeIntoExpression: (prepare) => {
                    return (expr) => {
                      expr.writePropertyAccess(lengthVar.identifierToken).source.writeVariableReference(thisFixedDataVar);
                    };
                  },
                })
              });
            },
            genType: { generate: () => basics.int },
            token: context.globalWriter.errorToken,
            isField: true,
          });
        }
      }
    });
  }
  for (const binding of collectedTextures) {
    const self = this;

    const debugName = binding.path.at(-1)?.identifier ?? typeToBind.debugName;

    const textureBindingLocation = nextBindingLocation++;
    const samplerBindingLocation = nextBindingLocation++;

    const instanceScope = context.instanceVars.scope;
    const instanceBlockWriter = context.instanceVars.blockWriter;
    const instanceVarsIdentifier = context.instanceVars.codeVar.identifierToken;

    const samplerInstanceVar = instanceScope.allocateVariableIdentifier(basics.TextureSampler.codeTypeSpec, BapIdentifierPrefix.Field, `${debugName}_sampler`);
    instanceBlockWriter.body.writeField(samplerInstanceVar.identifierToken, samplerInstanceVar.typeSpec);

    bindings.push({
      type: 'texture',
      nameHint: binding.path.at(-1)?.identifier ?? 'unknown',
      location: textureBindingLocation,
      marshal(dataVar: CodeVariable, body: CodeStatementWriter): { textureVar: CodeVariable; samplerVar: CodeVariable; } {
        return self.asParent(() => {
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
          for (const part of binding.path) {
            leafGen = new BapPropertyAccessExpressionVisitor().manual({ thisGen: leafGen, identifierName: part.identifier });
          }
          const leafValue = leafGen?.generateRead(context);
          const leafWriter = leafValue?.writeIntoExpression?.(body);
          const extractedPropVar = body.scope.allocateVariableIdentifier(basics.Texture.codeTypeSpec, BapIdentifierPrefix.Local, `bindTexture_${debugName}`);
          let readExprLeaf = body.writeVariableDeclaration(extractedPropVar).initializer.writeExpression();

          const samplerVar = body.scope.allocateVariableIdentifier(basics.Texture.codeTypeSpec, BapIdentifierPrefix.Local, `bindTextureSampler_${debugName}`);
          body.writeVariableDeclaration(samplerVar).initializer.writeExpression().writePropertyAccess(samplerInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);

          leafWriter?.(readExprLeaf);
          return { textureVar: extractedPropVar, samplerVar: samplerVar };
        });
      },
      unmarshal(textureDataVar: CodeVariable, samplerDataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void {
        const debugName = binding.path.map(f => f.identifier).join('_');

        const prototypeScope = new BapPrototypeScope();
        const staticScope = new BapPrototypeScope();
        const shadowType: BapTypeSpec = {
          prototypeScope: prototypeScope,
          staticScope: staticScope,
          typeParameters: [],
          codeTypeSpec: basics.Texture.codeTypeSpec,
          isShadow: true,
          debugName: basics.Texture.debugName + '_shadow',
        };

        unmarshalProxyPath(binding.path, intoContext, {
          generateRead: () => ({
            type: 'eval',
            typeSpec: shadowType,
            writeIntoExpression: (prepare) => {
              return (expr) => {
                expr.writeVariableReference(textureDataVar);
              };
            },
          }),
        });

        const sizeVar = binding.marshalStructFields.size;
        if (sizeVar && fixedDataVar) {
          const thisSizeVar = sizeVar;
          const thisFixedDataVar = fixedDataVar;

          prototypeScope.declare('size', {
            gen: (bindScope) => {
              return ({
                generateRead: () => ({
                  type: 'eval',
                  typeSpec: basics.int2,
                  writeIntoExpression: (prepare) => {
                    return (expr) => {
                      expr.writePropertyAccess(thisSizeVar.identifierToken).source.writeVariableReference(thisFixedDataVar);
                    };
                  },
                })
              });
            },
            genType: { generate: () => basics.int2 },
            token: context.globalWriter.errorToken,
            isField: true,
          });

          prototypeScope.declare('sample', {
            gen: (bindScope) => {
              return ({
                generateRead: (context) => ({
                  type: 'function',
                  typeSpec: self.types.primitiveTypeSpec(CodePrimitiveType.Function),
                  resolve: (args: Array<BapSubtreeValue|undefined>, typeArgs: BapTypeSpec[]): BapSubtreeValue => {
                    const inKernel = context.scope.resolvedGpu?.kernel;
                    const uvValue = args.at(0);
                    return {
                      type: 'eval',
                      typeSpec: basics.float4,
                      writeIntoExpression: (prepare) => {
                        const uvWriter = uvValue?.writeIntoExpression?.(prepare);
                        return (expr) => {
                          if (inKernel !== BapGpuKernelScope.Fragment) {
                            const sampleCall = expr.writeStaticFunctionCall(writer.makeInternalToken('textureLoad'));
                            sampleCall.addArg().writeVariableReference(textureDataVar); // texture
                            const coordArg = sampleCall.addArg(); // coords
                            const coordCalc = coordArg
                                .writeStaticFunctionCall(writer.makeInternalToken('vec2i')).addArg()
                                .writeStaticFunctionCall(writer.makeInternalToken('round')).addArg()
                                .writeBinaryOperation(CodeBinaryOperator.Divide);
                            uvWriter?.(coordCalc.lhs);
                            coordCalc.rhs
                                .writeStaticFunctionCall(writer.makeInternalToken('vec2f')).addArg()
                                .writePropertyAccess(thisSizeVar.identifierToken).source
                                .writeVariableReference(thisFixedDataVar);
                            sampleCall.addArg().writeLiteralInt(0); // level
                          } else {
                            const sampleCall = expr.writeStaticFunctionCall(writer.makeInternalToken('textureSample'));
                            sampleCall.addArg().writeVariableReference(textureDataVar); // texture
                            sampleCall.addArg().writeVariableReference(samplerDataVar); // sampler
                            uvWriter?.(sampleCall.addArg()); // coords
                          }
                        };
                      },
                    };
                  },
                })
              });
            },
            genType: { generate: () => basics.int },
            token: context.globalWriter.errorToken,
            isField: true,
          });
        }
      },
      writeIntoInitFunc: (body: CodeStatementWriter) => {
        const samplerAssign = body.writeAssignmentStatement();
        samplerAssign.ref.writePropertyAccess(samplerInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
        samplerAssign.value.writeStaticFunctionCall(writer.makeInternalToken('MTLCreateSampler'));
      },
    });
  }

  if (collectedArrays.length > 0 || collectedTextures.length > 0) {
    if (typeToBind.marshal) {
      typeToBind.marshal.blittable = false;
    }
  }

  return { bindings };
}
