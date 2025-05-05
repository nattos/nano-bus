import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { BapSubtreeGenerator, BapGenerateContext, BapSubtreeValue, BapTypeSpec, BapFields } from '../bap-value';
import { BapRootContextMixin } from '../bap-root-context-mixin';
import { BopIdentifierPrefix } from '../bop-data';
import { CodeAttributeKey, CodeBinaryOperator, CodeExpressionWriter, CodeNamedToken, CodeScopeType, CodeStatementWriter, CodeTypeSpec, CodeVariable } from '../code-writer';
import { getNodeLabel } from '../ts-helpers';
import { BapPrototypeMember, BapPrototypeScope, BapScope } from '../bap-scope';
import { BapPropertyAccessExpressionVisitor } from './property-access-expression';

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
    // console.log(typeParameterNames);
    // if (instantatedFromSignature?.typeParameters) {
    //   instantatedFromSignature.typeParameters[0].
    //   // Reverse map to extrapolate type parameters.
    //   const typeMapper = (((functionSignature as any).mapper) as tsTypeMapper|undefined);
    //   if (typeMapper) {
    //     typeParameters = instantatedFromSignature.typeParameters.map(t => utils.upcast({ identifier: t.symbol.name, type: this.resolveType(tsGetMappedType(t, typeMapper, this.tc)) }));
    //   }
    // }

    const funcGen = this.child(node.expression);
    const argGens = node.arguments.map(arg => this.child(arg));
    const typeArgGens = node.typeArguments?.map(typeArg => this.child(typeArg));
    return this.manual({ funcGen, argGens, typeArgGens, typeParameterNames });

    // const callingFuncConcreteImpl = this.currentFunctionConcreteImpl;
    // if (!this.verifyNotNulllike(callingFuncConcreteImpl, `Function calls from the global scope are not supported.`)) {
    //   return;
    // }

    // // Hacky special cases!!! These are necessary for now since specialized
    // // generics handling, like vararg expansions are not supported.
    // let specialHandling: BopStage|undefined;
    // for (const specialHandler of this.specialHandlers) {
    //   specialHandling = specialHandler(node);
    //   if (specialHandling) {
    //     break;
    //   }
    // }
    // if (specialHandling) {
    //   return specialHandling;
    // }

    // // TODO: Resolve function expressions.
    // const oldAsAssignableRef = this.asAssignableRef;
    // this.asAssignableRef = true;
    // const functionBop = this.visitChild(node.expression);
    // this.asAssignableRef = oldAsAssignableRef;

    // const candidatesOutArray: ts.Signature[] = [];
    // const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments.length);
    // if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
    //   return;
    // }
    // // console.log(this.tc.signatureToString(functionSignature));

    // let typeParameters: BopFields = [];
    // const instantatedFromSignature = (functionSignature as any)?.target as ts.Signature|undefined;
    // if (instantatedFromSignature?.typeParameters) {
    //   // Reverse map to extrapolate type parameters.
    //   const typeMapper = (((functionSignature as any).mapper) as tsTypeMapper|undefined);
    //   if (typeMapper) {
    //     typeParameters = instantatedFromSignature.typeParameters.map(t => utils.upcast({ identifier: t.symbol.name, type: this.resolveType(tsGetMappedType(t, typeMapper, this.tc)) }));
    //   }
    // }

    // let functionVar: BopVariable|undefined;
    // return this.makeCallBop(node, () => {
    //   const functionExprResult = this.readFullResult(functionBop);
    //   const functionRef = functionExprResult?.expressionResult;
    //   const thisRef = functionExprResult?.thisResult;
    //   if (!functionRef) {
    //     return;
    //   }
    //   const genericFunction = functionRef?.genericFunctionResult;
    //   if (genericFunction) {
    //     functionVar = this.instantiateGenericFunction(genericFunction, typeParameters);
    //   }
    //   functionVar ??= functionRef;
    //   // const functionOf = functionVar.bopType.functionOf;
    //   const functionOf = this.resolveFunctionOverload(functionVar.bopType, functionSignature);
    //   if (!this.verifyNotNulllike(functionOf, `Expression is not callable.`)) {
    //     return;
    //   }
    //   if (functionOf.isMethod && !this.verifyNotNulllike(thisRef?.result, `Cannot call instance method in a static context.`)) {
    //     return;
    //   }
    //   if (functionOf.concreteImpl) {
    //     functionOf.concreteImpl.referencedFrom.add(callingFuncConcreteImpl);
    //     callingFuncConcreteImpl.references.add(functionOf.concreteImpl);
    //   }
    //   return { functionVar: functionVar, thisVar: thisRef, functionOf };
    // }, node.arguments);
  }
}

















export class BufferFiller extends BapRootContextMixin {
  gpuVar: CodeVariable = null as any;
  baseOffsetVar?: CodeVariable;

  constructor(readonly context: BapGenerateContext, readonly cpuVar: CodeVariable) {
    super(context.scope.rootContext);
  }

  writeCpu(copyAsType: BapTypeSpec, byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
    if (!this.verifyNotNulllike(copyAsType.libType, `Cannot marshal type ${copyAsType.debugName}.`)) {
      return body.writeExpressionStatement().expr;
    }
    const callExpr = body.writeExpressionStatement().expr.writeMethodCall(this.context.globalWriter.makeInternalToken('write_' + copyAsType.libType.identifier));
    callExpr.source.writeVariableReference(this.cpuVar);
    if (this.baseOffsetVar) {
      const addOp = callExpr.addArg().writeBinaryOperation(CodeBinaryOperator.Add);
      addOp.lhs.writeVariableReference(this.baseOffsetVar);
      addOp.rhs.writeLiteralInt(byteOffset);
    } else {
      callExpr.addArg().writeLiteralInt(byteOffset);
    }
    return callExpr.addArg();
    // return this.writeCpuWrite(copyAsType.codeTypeSpec, byteOffset, body);
    // if (type === 'float') {
    //   return this.writeCpuWriteFloat(byteOffset, body);
    // } else {
    //   return this.writeCpuWriteInt(byteOffset, body);
    // }
  }
  // writeCpuWriteFloat(byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
  //   return this.writeCpuWrite(this.context.globalWriter.makeInternalToken('writeFloat'), byteOffset, body);
  // }
  // writeCpuWriteInt(byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
  //   return this.writeCpuWrite(this.context.globalWriter.makeInternalToken('writeInt'), byteOffset, body);
  // }

  // private writeCpuWrite(writeMethod: CodeTypeSpec, byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
  //   const callExpr = body.writeExpressionStatement().expr.writeMethodCall(writeMethod.asStruct!);
  //   callExpr.source.writeVariableReference(this.cpuVar);
  //   if (this.baseOffsetVar) {
  //     const addOp = callExpr.addArg().writeBinaryOperation(CodeBinaryOperator.Add);
  //     addOp.lhs.writeVariableReference(this.baseOffsetVar);
  //     addOp.rhs.writeLiteralInt(byteOffset);
  //   } else {
  //     callExpr.addArg().writeLiteralInt(byteOffset);
  //   }
  //   return callExpr.addArg();
  // }
  // private writeCpuWrite(writeMethod: CodeNamedToken, byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
  //   const callExpr = body.writeExpressionStatement().expr.writeMethodCall(writeMethod);
  //   callExpr.source.writeVariableReference(this.cpuVar);
  //   if (this.baseOffsetVar) {
  //     const addOp = callExpr.addArg().writeBinaryOperation(CodeBinaryOperator.Add);
  //     addOp.lhs.writeVariableReference(this.baseOffsetVar);
  //     addOp.rhs.writeLiteralInt(byteOffset);
  //   } else {
  //     callExpr.addArg().writeLiteralInt(byteOffset);
  //   }
  //   return callExpr.addArg();
  // }
}


export interface GpuBindingBase {
  nameHint: string;
  location: number;
  unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void;
}
export interface GpuFixedBinding extends GpuBindingBase {
  type: 'fixed';
  byteLength: number;
  // marshalStructType: BapTypeSpec;
  marshalStructCodeTypeSpec: CodeTypeSpec;
  marshal(dataVar: CodeVariable, bufferVars: BufferFiller, body: CodeStatementWriter): void;
}
export interface GpuArrayBinding extends GpuBindingBase {
  type: 'array';
  userType: BapTypeSpec;
  marshal(dataVar: CodeVariable, body: CodeStatementWriter): { arrayVar: CodeVariable };
}
export type GpuBinding = GpuFixedBinding|GpuArrayBinding;

export interface GpuBindings {
  bindings: GpuBinding[];
}






export function resolveBapFields(type: BapTypeSpec, context: BapGenerateContext): BapFields {
  const fields: BapFields = [];
  for (const [fieldName, member] of type.prototypeScope.allFields) {
    if (!member.isField || typeof fieldName !== 'string') {
      continue;
    }
    const fieldType = member.genType.generate(context);
    if (!fieldType) {
      continue;
    }
    fields.push({
      identifier: fieldName,
      type: fieldType,
    });
  }
  return fields;
}


export function makeGpuBindings(this: BapVisitor, context: BapGenerateContext, bopType: BapTypeSpec, options?: { bindingLocation: CodeAttributeKey }, visitedSet?: Set<BapTypeSpec>): GpuBindings {
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
  if (!pushVisitType(bopType)) {
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
    },
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

  const typeFields = resolveBapFields(bopType, context);
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
        const elementBindings = makeGpuBindings.bind(this)(context, arrayOfType, options, thisVisitedSet);
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
  }
  visitRec([], typeFields);
  popVisitType(bopType);

  const bindings: GpuBinding[] = [];
  if (collectedCopyFields.length > 0) {
    let byteLengthAcc = 0;
    collectedCopyFields.forEach(f => byteLengthAcc += f.copyAsType.libType?.marshalSize ?? 4);
    const byteLength = byteLengthAcc;

    const marshalStructIdentifier = writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${bopType.debugName}_gpuMarshal`);
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
      const rawField = marshalStructScope.allocateVariableIdentifier(bopType.codeTypeSpec, BopIdentifierPrefix.Field, nameHint);
      // rawBopVar.result = rawField;
      marshalStructWriter.body.writeField(rawField.identifierToken, bopType.codeTypeSpec, { attribs: [ { key: bindingLocation, intValue: fieldIndex } ] });
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
            let leafGen: BapSubtreeGenerator|undefined = {
              generateRead: () => {
                return {
                  type: 'cached',
                  typeSpec: bopType,
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
          const proxyVar = body.scope.allocateVariableIdentifier(field.type.codeTypeSpec, BopIdentifierPrefix.Local, field.path.map(p => p.identifier).join('_'));
          body.writeVariableDeclaration(proxyVar)
              .initializer.writeExpression().writePropertyAccess(field.marshaledVar.identifierToken)
              .source.writeVariableReference(dataVar);

          let childScope = rootScope;
          let leafVar;
          for (let i = 0; i < field.path.length; ++i) {
            const part = field.path[i];
            const requiresShadow = i < field.path.length - 1;
            const fieldName = part.identifier;
            let fieldVar: BapPrototypeMember|undefined = childScope.resolveMember(fieldName);
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
                gen: (bindScope) => { return ({ generateRead: () => ({
                  type: 'eval',
                  typeSpec: shadowType,
                }) }); },
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
            leafVar.gen = (bindScope) => { return ({ generateRead: () => ({
              type: 'eval',
              typeSpec: field.type,
              writeIntoExpression: (prepare) => {
                return (expr) => {
                  expr.writePropertyAccess(field.marshaledVar.identifierToken).source.writeVariableReference(dataVar);
                };
              },
            }) }) };
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












export function bopShaderBinding(this: BapVisitor, node: ts.CallExpression): BapSubtreeGenerator|undefined {
  // Hacky special cases!!! These are necessary for now since specialized
  // generics handling, like vararg expansions are not supported.
  const isRenderElements =
      ts.isCallExpression(node.expression) &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression.expression) &&
      this.tc.getTypeAtLocation(node.expression.expression.expression.expression)?.symbol?.name === 'GpuStatic' &&
      node.expression.expression.expression.name.text === 'renderElements';
  if (isRenderElements) {
    return bopRenderElementsCall.bind(this)(node, node.expression, node.expression.expression);
  }
}




export function bopRenderElementsCall(
  this: BapVisitor,
  fragmentCallNode: ts.CallExpression,
  vertexCallNode: ts.CallExpression,
  renderElementsCallNode: ts.CallExpression,
): BapSubtreeGenerator|undefined {
  // const fragmentCallNode = node;
  // const vertexCallNode = node.expression;
  // const renderElementsCallNode = node.expression.expression;
  const fragmentFunctionSignature = this.tc.getResolvedSignature(fragmentCallNode, [], fragmentCallNode.arguments.length);
  const vertexFunctionSignature = this.tc.getResolvedSignature(vertexCallNode, [], vertexCallNode.arguments.length);
  const renderElementsFunctionSignature = this.tc.getResolvedSignature(renderElementsCallNode, [], renderElementsCallNode.arguments.length);
  if (!this.verifyNotNulllike(renderElementsFunctionSignature, `Gpu.renderElements function has unresolved signature.`) ||
      !this.verifyNotNulllike(vertexFunctionSignature, `Vertex function has unresolved signature.`) ||
      !this.verifyNotNulllike(fragmentFunctionSignature, `Fragment function has unresolved signature.`)) {
    return;
  }

  console.log(this.tc.signatureToString(renderElementsFunctionSignature));
  console.log(this.tc.signatureToString(vertexFunctionSignature));
  console.log(this.tc.signatureToString(fragmentFunctionSignature));

  const fragmentArgBops = fragmentCallNode.arguments.map(arg => this.child(arg));
  const vertexArgBops =  vertexCallNode.arguments.map(arg => this.child(arg));

  const renderElementsArgs = renderElementsCallNode.arguments;
  if (renderElementsArgs.length !== 3) {
    this.logAssert(`Call to Gpu.renderElements takes 3 arguments (${renderElementsArgs.length} provided).`);
    return;
  }

  const primitiveCountBop = this.child(renderElementsArgs[0]);
  // Prevent temporaries from getting created. We only need the names, not
  // references, since these will be GPU only.
  const vertexFunctionBop = this.child(renderElementsArgs[1]);
  const fragmentFunctionBop = this.child(renderElementsArgs[2]);

  return {
    generateRead: (context) => {
      const vertexFunctionValue = vertexFunctionBop?.generateRead(context);
      const fragmentFunctionValue = fragmentFunctionBop?.generateRead(context);
      const primitiveCountValue = primitiveCountBop?.generateRead(context);
      const positionsValue = vertexArgBops[0]?.generateRead(context);
      const vertexOptionsValue = vertexArgBops[1]?.generateRead(context);
      const fragmentOptionsValue = fragmentArgBops[0]?.generateRead(context);

      return {
        type: 'cached',
        writeIntoExpression: (prepare) => {
          if (vertexFunctionValue?.type !== 'function') {
            this.logAssert(`Vertex shader is not a function.`);
            return;
          }
          if (fragmentFunctionValue?.type !== 'function') {
            this.logAssert(`Fragment shader is not a function.`);
            return;
          }
          console.log(vertexFunctionBop, vertexFunctionValue);
          const vertexKernel = vertexFunctionValue.generateGpuKernel?.();
          const fragmentKernel = fragmentFunctionValue.generateGpuKernel?.();
          if (!this.verifyNotNulllike(vertexKernel, () => `Cannot use function as vertex shader.`) ||
              !this.verifyNotNulllike(fragmentKernel, () => `Cannot use function as fragment shader.`)) {
            return;
          }

          const primitiveCountWriter = primitiveCountValue?.writeIntoExpression?.(prepare);
          const positionsWriter = positionsValue?.writeIntoExpression?.(prepare);
          const vertexOptionsWriter = vertexOptionsValue?.writeIntoExpression?.(prepare);
          const fragmentOptionsWriter = fragmentOptionsValue?.writeIntoExpression?.(prepare);

          // Resolve vertex function.
          // Emit a wrapper GPU vertex function.
          // const vertexFunctionExprResult = this.readFullResult(vertexFunctionBop);
          // // const vertexFunctionConcreteImpl = vertexFunctionExprResult?.expressionResult?.bopType.functionOf?.concreteImpl;
          // const vertexFunctionConcreteImpl = this.resolveFunctionOverload(vertexFunctionExprResult?.expressionResult?.bopType, vertexFunctionSignature)?.concreteImpl;
          // const fragmentFunctionExprResult = this.readFullResult(fragmentFunctionBop);
          // // const fragmentFunctionConcreteImpl = fragmentFunctionExprResult?.expressionResult?.bopType.functionOf?.concreteImpl;
          // const fragmentFunctionConcreteImpl = this.resolveFunctionOverload(fragmentFunctionExprResult?.expressionResult?.bopType, fragmentFunctionSignature)?.concreteImpl;
          // if (!this.verifyNotNulllike(vertexFunctionConcreteImpl, `Vertex shader is not concrete.`) ||
          //     !this.verifyNotNulllike(vertexFunctionConcreteImpl.bopVar.result, `Vertex shader is not complete.`) ||
          //     !this.verifyNotNulllike(fragmentFunctionConcreteImpl, `Fragment shader is not concrete.`) ||
          //     !this.verifyNotNulllike(fragmentFunctionConcreteImpl.bopVar.result, `Fragment shader is not complete.`)) {
          //   return;
          // }

          const pipelineName = 'vertex_frag';
          // const pipelineName = vertexFunctionConcreteImpl.bopVar.nameHint + '_' + fragmentFunctionConcreteImpl.bopVar.nameHint;


          // // Do _not_ mark references, as they are referenced indirectly.
          // const vertexFuncIdentifier = vertexFunctionConcreteImpl.bopVar.result.identifierToken;
          // vertexFunctionConcreteImpl.touchedByGpu = true;
          // const fragmentFuncIdentifier = fragmentFunctionConcreteImpl.bopVar.result.identifierToken;
          // fragmentFunctionConcreteImpl.touchedByGpu = true;
          const basics = this.types.basic(context);
          const instanceScope = context.instanceVars.scope;
          const instanceBlockWriter = context.instanceVars.blockWriter;
          const instanceVarsIdentifier = context.instanceVars.codeVar.identifierToken;

          const pipelineInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLRenderPipelineDescriptor.codeTypeSpec, BopIdentifierPrefix.Field, `${pipelineName}_pipeline`);
          instanceBlockWriter.body.writeField(pipelineInstanceVar.identifierToken, basics.MTLRenderPipelineDescriptor.codeTypeSpec);
          const renderPassDescriptorInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLRenderPassDescriptor.codeTypeSpec, BopIdentifierPrefix.Field, `${pipelineName}_renderPassDescriptor`);
          instanceBlockWriter.body.writeField(renderPassDescriptorInstanceVar.identifierToken, basics.MTLRenderPassDescriptor.codeTypeSpec);

          const vertexFunctionInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLFunction.codeTypeSpec, BopIdentifierPrefix.Field, `${pipelineName}_vertexShader`);
          instanceBlockWriter.body.writeField(vertexFunctionInstanceVar.identifierToken, basics.MTLFunction.codeTypeSpec);
          const fragmentFunctionInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLFunction.codeTypeSpec, BopIdentifierPrefix.Field, `${pipelineName}_fragmentShader`);
          instanceBlockWriter.body.writeField(fragmentFunctionInstanceVar.identifierToken, basics.MTLFunction.codeTypeSpec);

          // Resolve fragment function.
          // Emit a wrapper GPU fragment function.


          const vertexFuncIdentifier = vertexKernel.token;
          const fragmentFuncIdentifier = fragmentKernel.token;
          // const vertexFuncIdentifier = instanceScope.allocateVariableIdentifier(basics.MTLRenderPipelineDescriptor.codeTypeSpec, BopIdentifierPrefix.Field, `${pipelineName}_vert`).identifierToken;
          // const fragmentFuncIdentifier = instanceScope.allocateVariableIdentifier(basics.MTLRenderPipelineDescriptor.codeTypeSpec, BopIdentifierPrefix.Field, `${pipelineName}_frag`).identifierToken;


          // Emit pipeline setup code, and store the pipeline in globals.
          const writer = context.globalWriter;
          {
            const initFuncIdentifier = writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, `${pipelineName}_prepare`);
            // const initFuncBlock = this.globalBlock.createChildBlock(CodeScopeType.Function);
            const initFuncScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Function);
            const initFunc = writer.global.writeFunction(initFuncIdentifier.identifierToken);
            initFunc.touchedByCpu = true;
            initFunc.returnTypeSpec = CodeTypeSpec.voidType;
            this.rootContext.globals.prepareFuncs.push(initFuncIdentifier);
            const blockWriter = initFunc.body;

            const allocTmpOut = (type: BapTypeSpec): CodeVariable => {
              const outVar = blockWriter.scope.createVariableInScope(type.codeTypeSpec, pipelineName);
              return outVar;
            };

            // id<MTLFunction> vertexFunction = [defaultLibrary newFunctionWithName:@"drawTriangle1_vertexShader"];
            const vertexFunctionVar = allocTmpOut(basics.MTLFunction);
            const vertexFunction = blockWriter.writeVariableDeclaration(vertexFunctionVar);
            const vertexFunctionInit = vertexFunction.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MTLLibraryNewFunctionWithName'));
            vertexFunctionInit.addArg().writeLiteralStringToken(vertexFuncIdentifier, { managed: true });

            // id<MTLFunction> fragmentFunction = [defaultLibrary newFunctionWithName:@"drawTriangle1_fragmentShader"];
            const fragmentFunctionVar = allocTmpOut(basics.MTLFunction);
            const fragmentFunction = blockWriter.writeVariableDeclaration(fragmentFunctionVar);
            const fragmentFunctionInit = fragmentFunction.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MTLLibraryNewFunctionWithName'));
            fragmentFunctionInit.addArg().writeLiteralStringToken(fragmentFuncIdentifier, { managed: true });

            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(vertexFunctionInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
              assign.value.writeVariableReference(vertexFunctionVar);
            }
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(fragmentFunctionInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
              assign.value.writeVariableReference(fragmentFunctionVar);
            }

            // MTLRenderPipelineDescriptor* pipelineStateDescriptor = [[MTLRenderPipelineDescriptor alloc] init];
            const pipelineStateDescriptorVar = allocTmpOut(basics.MTLRenderPipelineDescriptor);
            const pipelineStateDescriptor = blockWriter.writeVariableDeclaration(pipelineStateDescriptorVar);
            const pipelineStateDescriptorInit = pipelineStateDescriptor.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MakeMTLRenderPipelineDescriptor'));

            // pipelineStateDescriptor.label = @"RenderPrimitives";
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(writer.makeInternalToken('label')).source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeLiteralString(pipelineName, { managed: true });
            }
            // pipelineStateDescriptor.vertexFunction = vertexFunction;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(writer.makeInternalToken('vertexFunction')).source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeVariableReference(vertexFunctionVar);
            }
            // pipelineStateDescriptor.fragmentFunction = fragmentFunction;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(writer.makeInternalToken('fragmentFunction')).source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeVariableReference(fragmentFunctionVar);
            }
            // pipelineStateDescriptor.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm_sRGB;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('pixelFormat'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLPixelFormatBGRA8Unorm_sRGB'));
            }
            // pipelineStateDescriptor.colorAttachments[0].blendingEnabled = true;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('blendingEnabled'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeLiteralBool(true);
            }
            // pipelineStateDescriptor.colorAttachments[0].alphaBlendOperation = MTLBlendOperationAdd;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('alphaBlendOperation'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLBlendOperationAdd'));
            }
            // pipelineStateDescriptor.colorAttachments[0].rgbBlendOperation = MTLBlendOperationAdd;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('rgbBlendOperation'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLBlendOperationAdd'));
            }
            // pipelineStateDescriptor.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOne;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('destinationAlphaBlendFactor'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLBlendFactorOne'));
            }
            // pipelineStateDescriptor.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOne;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('destinationRGBBlendFactor'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLBlendFactorOne'));
            }
            // pipelineStateDescriptor.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('sourceAlphaBlendFactor'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLBlendFactorOne'));
            }
            // pipelineStateDescriptor.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('sourceRGBBlendFactor'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(pipelineStateDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLBlendFactorSourceAlpha'));
            }
            // drawTriangle1_pipeline1 = [device newRenderPipelineStateWithDescriptor:pipelineStateDescriptor error:&error];
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(pipelineInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
              const call = assign.value.writeStaticFunctionCall(writer.makeInternalToken('MTLNewRenderPipelineStateWithDescriptor'));
              call.addArg().writeVariableReference(pipelineStateDescriptorVar);
            }
            // MTLRenderPassDescriptor* renderPassDescriptor = [MTLRenderPassDescriptor new];
            const renderPassDescriptorVar = allocTmpOut(basics.MTLRenderPassDescriptor);
            const renderPassDescriptor = blockWriter.writeVariableDeclaration(renderPassDescriptorVar);
            const renderPassDescriptorInit = renderPassDescriptor.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MakeMTLRenderPassDescriptor'));
            // renderPassDescriptor.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('clearColor'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(renderPassDescriptorVar);
              const call = assign.value.writeStaticFunctionCall(writer.makeInternalToken('MTLClearColorMake'));
              call.addArg().writeLiteralFloat(0);
              call.addArg().writeLiteralFloat(0);
              call.addArg().writeLiteralFloat(0);
              call.addArg().writeLiteralFloat(0);
            }
            // renderPassDescriptor.colorAttachments[0].loadAction = MTLLoadActionClear;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('loadAction'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(renderPassDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLLoadActionClear'));
            }
            // renderPassDescriptor.colorAttachments[0].storeAction = MTLStoreActionStore;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('storeAction'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(renderPassDescriptorVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLStoreActionStore'));
            }
            // drawTriangle1_renderPassDescriptor1 = renderPassDescriptor;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(renderPassDescriptorInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
              assign.value.writeVariableReference(renderPassDescriptorVar);
            }
          }






          const blockWriter = prepare;
          {
            const allocTmpOut = (type: BapTypeSpec): CodeVariable => {
              const outVar = blockWriter.scope.createVariableInScope(type.codeTypeSpec, getNodeLabel(renderElementsCallNode));
              return outVar;
            };

            // auto positions = generateTriangleVertices(10);
            // const positionsVar = allocTmpOut(this.functionType);
            // const positionsVar = this.readResult(vertexArgBops[0]).result!;
            // const vertexOptionsBopVar = this.readResult(vertexArgBops[1]);
            // const fragmentOptionsBopVar = this.readResult(fragmentArgBops[0]);

            // Texture renderTarget = AllocatePersistentTexture(GetTrackTextureFormat(), /* salt */ 12345678);
            const renderTargetVar = allocTmpOut(basics.Texture);
            const renderTarget = blockWriter.writeVariableDeclaration(renderTargetVar);
            const renderTargetInit = renderTarget.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('AllocatePersistentTexture'));
            renderTargetInit.addArg().writeStaticFunctionCall(writer.makeInternalToken('GetTrackTextureFormat'));
            renderTargetInit.addArg().writeLiteralInt(12345678);

            // Metadata_drawTriangle1_vertexShader metadata = {};
            // Metadata_drawTriangle1_fragmentShader metadata = {};



            // MTLRenderPassDescriptor* renderPassDescriptor = drawTriangle1_renderPassDescriptor1;
            const renderPassDescriptorVar = allocTmpOut(basics.MTLRenderPassDescriptor);
            const renderPassDescriptor = blockWriter.writeVariableDeclaration(renderPassDescriptorVar);
            const renderPassDescriptorInit = renderPassDescriptor.initializer.writeExpression().writePropertyAccess(renderPassDescriptorInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
            // renderPassDescriptor.colorAttachments[0].texture = renderTarget;
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref
                  .writePropertyAccess(writer.makeInternalToken('texture'))
                  .source.writeIndexAccess({ indexLiteral: 0 })
                  .source.writePropertyAccess(writer.makeInternalToken('colorAttachments'))
                  .source.writeVariableReference(renderPassDescriptorVar);
              assign.value.writeVariableReference(renderTargetVar);
            }
            // id<MTLRenderCommandEncoder> encoder = [GetCurrentCommandBuffer() renderCommandEncoderWithDescriptor:renderPassDescriptor];
            const encoderVar = allocTmpOut(basics.MTLRenderCommandEncoder);
            const encoder = blockWriter.writeVariableDeclaration(encoderVar);
            const encoderInit = encoder.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MakeMTLRenderCommandEncoder'));
            encoderInit.addArg().writeVariableReference(renderPassDescriptorVar);
            // encoder.label = @"RenderPrimitives";
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(writer.makeInternalToken('label')).source.writeVariableReference(encoderVar);
              assign.value.writeLiteralString('RenderPrimitives', { managed: true });
            }
            // [encoder setCullMode:MTLCullModeNone];
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(writer.makeInternalToken('cullMode')).source.writeVariableReference(encoderVar);
              assign.value.writeIdentifier(writer.makeInternalToken('MTLCullModeNone'));
            }
            // [encoder setRenderPipelineState:drawTriangle1_pipeline1];
            {
              const assign = blockWriter.writeAssignmentStatement();
              assign.ref.writePropertyAccess(writer.makeInternalToken('renderPipelineState')).source.writeVariableReference(encoderVar);
              assign.value.writePropertyAccess(pipelineInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
            }

            // [encoder setVertexBytes:&vertexMetadata length:sizeof(vertexMetadata) atIndex:0];
            // [encoder setVertexBuffer:position.GpuBuffer() offset:0 atIndex:1];
            {
              const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken('EncoderSetVertexAttributeBuffer'));
              call.addArg().writeVariableReference(encoderVar);
              positionsWriter?.(call.addArg());
              call.addArg().writeLiteralInt(0);
              call.addArg().writeLiteralInt(0);
            }
            // [encoder setVertexBytes:&vertexOptions length:sizeof(vertexOptions) atIndex:2];

            const bindBindings = (bindings: GpuBindings, dataVar: CodeVariable, stage: 'Vertex'|'Fragment') => {
              if (!this.verifyNotNulllike(bindings, `Expected GPU bindings for ${stage} function, but none were found.`)) {
                return;
              }
              for (const binding of bindings.bindings) {
                if (binding.type === 'fixed') {
                  var bufferFillerVar = blockWriter.scope.allocateVariableIdentifier(basics.BufferFiller.codeTypeSpec, BopIdentifierPrefix.Local, 'bufferFiller');
                  // console.log(basics.BufferFiller);
                  const stmt = blockWriter.writeVariableDeclaration(bufferFillerVar);
                  stmt.initializer.writeAssignStructField(writer.makeInternalToken('byteLength')).value.writeLiteralInt(binding.byteLength);
                  binding.marshal(dataVar, new BufferFiller(context, bufferFillerVar), blockWriter);

                  const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken(`EncoderSet${stage}Bytes`));
                  call.addArg().writeVariableReference(encoderVar);
                  call.addArg().writeMethodCall(writer.makeInternalToken('getBuffer')).source.writeVariableReference(bufferFillerVar);
                  call.addArg().writeLiteralInt(0);
                  call.addArg().writeLiteralInt(binding.location);
                } else if (binding.type === 'array') {
                  const { arrayVar }  = binding.marshal(dataVar, blockWriter);
                  const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken(`EncoderSet${stage}Buffer`));
                  call.addArg().writeVariableReference(encoderVar);
                  call.addArg().writeVariableReference(arrayVar);
                  call.addArg().writeLiteralInt(0);
                  call.addArg().writeLiteralInt(binding.location);
                }
              }
            };

            const vertexOptionsVar = allocTmpOut(vertexOptionsValue?.typeSpec!);
            const vertexOptionsVarDecl = blockWriter.writeVariableDeclaration(vertexOptionsVar);
            const fragmentOptionsVar = allocTmpOut(fragmentOptionsValue?.typeSpec!);
            const fragmentOptionsVarDecl = blockWriter.writeVariableDeclaration(fragmentOptionsVar);
            vertexOptionsWriter?.(vertexOptionsVarDecl.initializer.writeExpression());
            fragmentOptionsWriter?.(fragmentOptionsVarDecl.initializer.writeExpression());
            bindBindings(vertexKernel.bindings, vertexOptionsVar, 'Vertex');
            bindBindings(fragmentKernel.bindings, fragmentOptionsVar, 'Fragment');
            // {
            //   const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken('EncoderSetFragmentBytes'));
            //   call.addArg().writeVariableReference(encoderVar);
            //   call.addArg().writeVariableReference(fragmentOptionsVar);
            //   call.addArg().writeLiteralInt(0);
            //   call.addArg().writeLiteralInt(0);
            // }
            // [encoder setFragmentBytes:&fragmentMetadata length:sizeof(fragmentMetadata) atIndex:0];
            // [encoder setFragmentBytes:&fragmentOptions length:sizeof(fragmentOptions) atIndex:1];

            // [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:(uint)(positions.GetCount())];
            {
              const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken('EncoderDrawPrimitives'));
              call.addArg().writeVariableReference(encoderVar);
              call.addArg().writeIdentifier(writer.makeInternalToken('MTLPrimitiveTypeTriangle'));
              call.addArg().writeLiteralInt(0);
              primitiveCountWriter?.(call.addArg());
            }
            // [encoder endEncoding];
            {
              const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken('EncoderEndEncoding'));
              call.addArg().writeVariableReference(encoderVar);
            }
            // return renderTarget;
            {
              const ret = blockWriter.writeReturnStatement();
              ret.expr.writeVariableReference(renderTargetVar);
            }
          }


          // Allocate/resize persistent output texture.
          // Bind vertex stage buffers.
          // Bind fragment stage buffers.
          // Queue render command.
          // const outBopVar = this.block.mapIdentifier('tmp', basics.MTLFunction.tempType, basics.MTLFunction, /* anonymous */ true);
          // const outVar = blockWriter.scope.createVariableInScope(outBopVar.type, pipelineName);
          // outBopVar.result = outVar;

          // const newVar = blockWriter.writeVariableDeclaration(outVar);
          // newVar.initializer.writeExpression().writeLiteralInt(1234);
          // return { expressionResult: outBopVar };


          return undefined;
        },
      };
    },
  };
}


