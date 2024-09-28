import * as ts from "typescript";
import { CodeAttributeDecl, CodeAttributeKey, CodeBinaryOperator, CodeExpressionWriter, CodeFunctionWriter, CodeNamedToken, CodeScope, CodeScopeType, CodeStatementWriter, CodeTypeSpec, CodeVariable } from './code-writer';
import { BopFields, BopFunctionConcreteImplDetail, BopStructType, BopType } from './bop-type';
import { getNodeLabel } from './ts-helpers';
import { BopStage, BopIdentifierPrefix, BopVariable, BopBlock } from './bop-data';
import { BopProcessor } from './bop-processor';










class BufferFiller {
  gpuVar: CodeVariable = null as any;
  baseOffsetVar?: CodeVariable;

  constructor(readonly self: BopProcessor, readonly cpuVar: CodeVariable) {
  }

  writeCpu(type: 'int'|'float', byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
    if (type === 'float') {
      return this.writeCpuWriteFloat(byteOffset, body);
    } else {
      return this.writeCpuWriteInt(byteOffset, body);
    }
  }
  writeCpuWriteFloat(byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
    return this.writeCpuWrite(this.self.writer.makeInternalToken('writeFloat'), byteOffset, body);
  }
  writeCpuWriteInt(byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
    return this.writeCpuWrite(this.self.writer.makeInternalToken('writeInt'), byteOffset, body);
  }

  private writeCpuWrite(writeMethod: CodeNamedToken, byteOffset: number, body: CodeStatementWriter): CodeExpressionWriter {
    const callExpr = body.writeExpressionStatement().expr.writeMethodCall(writeMethod);
    callExpr.source.writeVariableReference(this.cpuVar);
    if (this.baseOffsetVar) {
      const addOp = callExpr.addArg().writeBinaryOperation(CodeBinaryOperator.Add);
      addOp.lhs.writeVariableReference(this.baseOffsetVar);
      addOp.rhs.writeLiteralInt(byteOffset);
    } else {
      callExpr.addArg().writeLiteralInt(byteOffset);
    }
    return callExpr.addArg();
  }
}


export interface GpuBindingBase {
  nameHint: string;
  location: number;
  marshal(dataVar: CodeVariable, bufferVars: BufferFiller, body: CodeStatementWriter): void;
  unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoBopVar: BopVariable): void;
}
export interface GpuFixedBinding extends GpuBindingBase {
  type: 'fixed';
  byteLength: number;
  marshalStructType: BopType;
}
export interface GpuArrayBinding extends GpuBindingBase {
  type: 'array';
  userType: BopType;
  elementMarshalBinding: GpuFixedBinding;
  writeGetLength(dataVar: CodeVariable, expr: CodeExpressionWriter): void;
}
export type GpuBinding = GpuFixedBinding|GpuArrayBinding;

export interface GpuBindings {
  bindings: GpuBinding[];
}


function makeGpuBindings(this: BopProcessor, bopType: BopType, visitedSet?: Set<BopType>): GpuBindings {
  const thisVisitedSet = visitedSet ?? new Set<BopType>();
  const pushVisitType = (t: BopType) => {
    if (thisVisitedSet.has(t)) {
      this.logAssert(`Attempted to bind a recursive type [ ${Array.from(thisVisitedSet).map(t => t.debugName).join(' => ')} ]`);
      return false;
    }
    thisVisitedSet.add(t);
    return true;
  };
  const popVisitType = (t: BopType) => {
    thisVisitedSet.delete(t);
  };
  if (!pushVisitType(bopType)) {
    return { bindings: [] };
  }

  const collectedCopyFields: Array<{ type: 'int'|'float', path: { identifier: CodeNamedToken, bopType: BopType }[], marshalStructField?: CodeVariable }> = [];
  const collectedArrays: Array<{ elementBinding: GpuFixedBinding, userType: BopType, path: { identifier: CodeNamedToken, bopType: BopType }[] }> = [];

  if (bopType.structOf) {
    const visitRec = (subpath: { identifier: CodeNamedToken, bopType: BopType }[], fields: BopVariable[]) => {
      for (const field of fields) {
        const fieldIdentifier = field.propertyResult?.internal?.directAccessIdentifier ?? field.result?.identifierToken;
        if (!fieldIdentifier) {
          continue;
        }
        const fieldSubpath = subpath.concat({ identifier: fieldIdentifier, bopType: field.bopType });
        if (field.bopType === this.intType) {
          collectedCopyFields.push({
            path: fieldSubpath,
            type: 'int',
          });
        } else if (field.bopType === this.floatType) {
          collectedCopyFields.push({
            path: fieldSubpath,
            type: 'float',
          });
        } else if (field.bopType.internalTypeOf?.arrayOfType) {
          const arrayOfType = field.bopType.internalTypeOf?.arrayOfType;
          console.log(arrayOfType);
          const elementBindings = makeGpuBindings.bind(this)(arrayOfType, thisVisitedSet);
          console.log(elementBindings);
          const elementBinding = elementBindings.bindings.find(b => b.type === 'fixed');
          if (elementBindings.bindings.length !== 1 || elementBinding?.type !== 'fixed') {
            this.logAssert(`Cannot bind array of type ${arrayOfType.debugName} as it is not blittable.`);
            continue;
          }
          collectedArrays.push({
            path: fieldSubpath,
            userType: arrayOfType,
            elementBinding: elementBinding,
          });
        } else if (field.bopType.structOf) {
          if (!pushVisitType(field.bopType)) {
            continue;
          }
          visitRec(fieldSubpath, field.bopType.structOf.fields);
          popVisitType(field.bopType);
        }
      }
    }
    visitRec([], bopType.structOf.fields);
  }
  popVisitType(bopType);

  const bindings: GpuBinding[] = [];
  if (collectedCopyFields.length > 0) {
    const byteLength = collectedCopyFields.length * 4;

    const marshalStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${bopType.storageType.asStruct?.nameHint}_gpuMarshal`);
    const marshalStructWriter = this.writer.global.writeStruct(marshalStructIdentifier);
    const marshalStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
    const marshalStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
    marshalStructWriter.touchedByGpu = true;
    const marshalStructFields: BopVariable[] = [];

    let fieldIndex = 0;
    for (const field of collectedCopyFields) {
      const bopType = field.type === 'float' ? this.floatType : this.intType;
      const nameHint = field.path.map(p => p.identifier.nameHint).join('_');
      const rawBopVar = marshalStructBlock.mapIdentifier(`${fieldIndex}_${nameHint}`, bopType.storageType, bopType);
      const rawField = marshalStructScope.allocateVariableIdentifier(rawBopVar.type, BopIdentifierPrefix.Field, nameHint);
      rawBopVar.result = rawField;
      marshalStructWriter.body.writeField(rawField.identifierToken, rawBopVar.type);
      marshalStructFields.push(rawBopVar);
      field.marshalStructField = rawField;
      fieldIndex++;
    }
    const marshalStructType = BopType.createPassByValue({
      debugName: marshalStructIdentifier.nameHint,
      valueType: CodeTypeSpec.fromStruct(marshalStructIdentifier),
      innerScope: marshalStructScope,
      innerBlock: marshalStructBlock,
      structOf: new BopStructType(marshalStructFields),
    });

    const self = this;
    bindings.push({
      type: 'fixed',
      nameHint: collectedCopyFields.map(f => f.path.at(-1)?.identifier.nameHint ?? 'unknown').join('_'),
      location: bindings.length,
      byteLength: byteLength,
      marshalStructType: marshalStructType,
      marshal(dataVar: CodeVariable, bufferFiller: BufferFiller, body: CodeStatementWriter): void {
        let offset = 0;
        for (const field of collectedCopyFields) {
          let readExprLeaf = bufferFiller.writeCpu(field.type, offset, body);
          for (let i = field.path.length - 1; i >= 0; --i) {
            const pathPart = field.path[i];
            const propAccess = readExprLeaf.writePropertyAccess(pathPart.identifier);
            readExprLeaf = propAccess.source;
          }
          readExprLeaf.writeVariableReference(dataVar);
          offset += 4;
        }
      },
      unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoBopVar: BopVariable): void {
        const rootBlock = intoBopVar.lookupBlockOverride ?? self.globalBlock.createChildBlock(CodeScopeType.Local);
        for (const field of collectedCopyFields) {
          const fieldType = field.type === 'float' ? self.floatType : self.intType;
          let childBlock = rootBlock;
          let leafVar;
          for (const part of field.path) {
            const fieldName = part.identifier.nameHint;
            let fieldVar = childBlock.identifierMap.get(fieldName);
            if (!fieldVar) {
              fieldVar = childBlock.mapIdentifier(fieldName, part.bopType.tempType, part.bopType);
              fieldVar.requiresDirectAccess = true;
              fieldVar.lookupBlockOverride = childBlock.createChildBlock(CodeScopeType.Local);
            }
            childBlock = fieldVar.lookupBlockOverride!;
            leafVar = fieldVar;
          }
          if (leafVar) {
            const proxyVar = body.scope.allocateVariableIdentifier(fieldType.tempType, BopIdentifierPrefix.Local, field.path.map(f => f.identifier.nameHint).join('_'));
            body.writeVariableDeclaration(proxyVar)
                .initializer.writeExpression().writePropertyAccess(field.marshalStructField!.identifierToken)
                .source.writeVariableReference(dataVar);
            leafVar.result = proxyVar;
          }
        }
        intoBopVar.requiresDirectAccess = true;
        intoBopVar.lookupBlockOverride = rootBlock;
      },
    });
  }
  for (const binding of collectedArrays) {
    const self = this;
    bindings.push({
      type: 'array',
      nameHint: binding.path.at(-1)?.identifier.nameHint ?? 'unknown',
      location: bindings.length,
      userType: binding.userType,
      elementMarshalBinding: binding.elementBinding,
      writeGetLength(dataVar: CodeVariable, expr: CodeExpressionWriter): void {
        let readExprLeaf = expr;
        readExprLeaf = readExprLeaf.writePropertyAccess(self.writer.makeInternalToken('length')).source;
        for (let i = binding.path.length - 1; i >= 0; --i) {
          const pathPart = binding.path[i];
          const propAccess = readExprLeaf.writePropertyAccess(pathPart.identifier);
          readExprLeaf = propAccess.source;
        }
        readExprLeaf.writeVariableReference(dataVar);
      },
      marshal(dataVar: CodeVariable, bufferFiller: BufferFiller, body: CodeStatementWriter): void {
        const arrayVar = body.scope.allocateVariableIdentifier(binding.elementBinding.marshalStructType.tempType, BopIdentifierPrefix.Local, `bindArray_${binding.path.at(-1)?.identifier.nameHint}`);
        let readExprLeaf = body.writeVariableDeclaration(arrayVar).initializer.writeExpression();
        for (let i = binding.path.length - 1; i >= 0; --i) {
          const pathPart = binding.path[i];
          const propAccess = readExprLeaf.writePropertyAccess(pathPart.identifier);
          readExprLeaf = propAccess.source;
        }
        readExprLeaf.writeVariableReference(dataVar);

        const forIndex = body.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'index');
        const forLength = body.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'length');
        this.writeGetLength(dataVar, body.writeVariableDeclaration(forLength).initializer.writeExpression());
        const forLoop = body.writeForLoop();
        forLoop.initializer.writeVariableDeclaration(forIndex).initializer.writeExpression().writeLiteralInt(0);
        const cond = forLoop.condition.writeBinaryOperation(CodeBinaryOperator.LessThan);
        cond.lhs.writeVariableReference(forIndex);
        cond.rhs.writeVariableReference(forLength);
        const updateAssign = forLoop.updatePart.writeAssignmentStatement();
        updateAssign.ref.writeVariableReference(forIndex);
        const updateIncrement = updateAssign.value.writeBinaryOperation(CodeBinaryOperator.Add);
        updateIncrement.lhs.writeVariableReference(forIndex);
        updateIncrement.rhs.writeLiteralInt(1);

        const elementVar = forLoop.body.scope.allocateVariableIdentifier(binding.elementBinding.marshalStructType.tempType, BopIdentifierPrefix.Local, 'element');
        const elementGet = forLoop.body.writeVariableDeclaration(elementVar).initializer.writeExpression().writeMethodCall(self.writer.makeInternalToken('at'));
        elementGet.addArg().writeVariableReference(forIndex);
        elementGet.source.writeVariableReference(arrayVar);

        const baseOffsetVar = forLoop.body.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'baseOffset');
        const baseOffset = forLoop.body.writeVariableDeclaration(baseOffsetVar).initializer.writeExpression().writeBinaryOperation(CodeBinaryOperator.Multiply);
        baseOffset.lhs.writeVariableReference(forIndex);
        baseOffset.rhs.writeLiteralInt(binding.elementBinding.byteLength);
        bufferFiller.baseOffsetVar = baseOffsetVar;
        binding.elementBinding.marshal(elementVar, bufferFiller, forLoop.body);
      },
      unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoBopVar: BopVariable): void {
        const rootBlock = intoBopVar.lookupBlockOverride ?? self.globalBlock.createChildBlock(CodeScopeType.Local);
        const fieldType = binding.userType;
        let childBlock = rootBlock;
        let leafVar;
        for (const part of binding.path) {
          const fieldName = part.identifier.nameHint;
          let fieldVar = childBlock.identifierMap.get(fieldName);
          if (!fieldVar) {
            fieldVar = childBlock.mapIdentifier(fieldName, part.bopType.tempType, part.bopType);
            fieldVar.requiresDirectAccess = true;
            fieldVar.lookupBlockOverride = childBlock.createChildBlock(CodeScopeType.Local);
          }
          childBlock = fieldVar.lookupBlockOverride!;
          leafVar = fieldVar;
        }
        if (leafVar) {
          // Arrays must be accessed directly, because WSGL doesn't have a way to create aliases currently.
          leafVar.requiresDirectAccess = true;
          leafVar.result = dataVar;
        }
        intoBopVar.requiresDirectAccess = true;
        intoBopVar.lookupBlockOverride = rootBlock;
      },
    });
  }
  return { bindings };
}










export type FuncMutatorFunc = (funcWriter: CodeFunctionWriter) => void;

export function bopRewriteShaderFunction(this: BopProcessor, data: {
  funcName: string;
  userReturnType: BopType;
  parameterSignatures: Array<{ identifier: string, type: ts.Type, isAutoField: boolean }>;
  functionBlock: BopBlock;
}) {
  const { funcName, userReturnType, parameterSignatures, functionBlock } = data;
  const paramDecls: BopFields = [];
  const params: { var: BopVariable, attribs?: CodeAttributeDecl[] }[] = [];
  // TODO: HAXXORZZZ !!!!!
  const isGpuVertexFunc = funcName.includes('vertexShader');
  const isGpuFragmentFunc = funcName.includes('fragmentShader');
  const isGpuBoundFunc = isGpuFragmentFunc || isGpuVertexFunc;
  if (!isGpuBoundFunc) {
    return false;
  }
  const stage = isGpuVertexFunc ? 'Vertex' : 'Fragment';

  const rewriterFuncs: FuncMutatorFunc[] = [];
  rewriterFuncs.push(funcWriter => {
    if (isGpuVertexFunc) {
      funcWriter.addAttribute({ key: CodeAttributeKey.GpuFunctionVertex });
    }
    if (isGpuFragmentFunc) {
      funcWriter.addAttribute({ key: CodeAttributeKey.GpuFunctionFragment });
      funcWriter.addReturnAttribute({ key: CodeAttributeKey.GpuBindLocation, intValue: 0 });
    }
  });

  let returnType;
  if (!userReturnType?.internalTypeOf && this.verifyNotNulllike(userReturnType.structOf?.fields, `${isGpuVertexFunc} output is not concrete.`)) {
    const vertexOutStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_${stage}Out`);
    const vertexOutStructWriter = this.writer.global.writeStruct(vertexOutStructIdentifier);
    const vertexOutStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
    const vertexOutStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
    vertexOutStructWriter.touchedByGpu = true;
    const vertexOutStructFields: BopVariable[] = [];

    let fieldIndex = 0;
    for (const field of userReturnType.structOf!.fields) {
      const attribs: CodeAttributeDecl[] = [];
      // TODO: MEGA HAXXOR!!!
      if (isGpuVertexFunc && field.nameHint.includes('position')) {
        attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
      } else {
        attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
      }
      const rawBopVar = vertexOutStructBlock.mapIdentifier(field.nameHint, field.type, field.bopType);
      const rawField = vertexOutStructScope.allocateVariableIdentifier(field.type, BopIdentifierPrefix.Field, field.nameHint);
      rawBopVar.result = rawField;
      vertexOutStructWriter.body.writeField(rawField.identifierToken, field.type, { attribs: attribs });
      vertexOutStructFields.push(rawBopVar);
      fieldIndex++;
    }

    // Grrr... WebGPU disallows empty structs.
    if (vertexOutStructWriter.body.fieldCount === 0) {
      vertexOutStructWriter.body.writeField(vertexOutStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
    }

    const vertexOutStructType = BopType.createPassByValue({
      debugName: `${funcName}_${isGpuVertexFunc}Out`,
      valueType: CodeTypeSpec.fromStruct(vertexOutStructIdentifier),
      innerScope: vertexOutStructScope,
      innerBlock: vertexOutStructBlock,
      structOf: new BopStructType(vertexOutStructFields),
    });

    returnType = vertexOutStructType;
  }

  const vertexStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_${stage}In`);
  const vertexStructWriter = this.writer.global.writeStruct(vertexStructIdentifier);
  const vertexStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
  const vertexStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
  vertexStructWriter.touchedByGpu = true;
  const vertexStructType = BopType.createPassByValue({
    debugName: `${funcName}_${isGpuVertexFunc}`,
    valueType: CodeTypeSpec.fromStruct(vertexStructIdentifier),
    innerScope: vertexStructScope,
    innerBlock: vertexStructBlock,
  });

  // const insStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_ins`);
  // const insStructWriter = this.writer.global.writeStruct(insStructIdentifier);
  // // insStructWriter.touchedByGpu = true;
  // const insStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
  // const insStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
  // // insStructWriter.touchedByGpu = true;
  // const insStructType = BopType.createPassByValue({
  //   debugName: `${funcName}_ins`,
  //   valueType: CodeTypeSpec.fromStruct(insStructIdentifier),
  //   innerScope: insStructScope,
  //   innerBlock: insStructBlock,
  // });











  let paramIndex = 0;
  let optionsGpuBindings: GpuBindings|undefined;
  for (const param of parameterSignatures) {
    const paramType = this.resolveType(param.type, { inBlock: functionBlock });
    paramDecls.push({ type: paramType, identifier: param.identifier });

    if (paramIndex === 0) {
      if (!this.verifyNotNulllike(paramType.structOf?.fields, `${isGpuVertexFunc} is not concrete.`)) {
        continue;
      }

      const rawArgVar = functionBlock.mapTempIdentifier(param.identifier, vertexStructType, /* anonymous */ true);
      params.push({ var: rawArgVar });

      const mappedArgBopVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
      let mappedArgVar!: CodeVariable;
      rewriterFuncs.push(funcWriter => {
        mappedArgVar = funcWriter.body.scope.allocateVariableIdentifier(paramType.tempType, BopIdentifierPrefix.Local, param.identifier);
        mappedArgBopVar.result = mappedArgVar;
        funcWriter.body.writeVariableDeclaration(mappedArgVar);
      });

      let fieldIndex = 0;
      for (const field of paramType.structOf!.fields) {
        const attribs: CodeAttributeDecl[] = [];
        // TODO: MEGA HAXXOR!!!
        if (isGpuFragmentFunc && field.nameHint.includes('position')) {
          attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
        } else {
          attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
        }
        const rawField = vertexStructScope.allocateIdentifier(BopIdentifierPrefix.Field, field.nameHint);
        vertexStructWriter.body.writeField(rawField, field.type, { attribs: attribs });
        rewriterFuncs.push(funcWriter => {
          const copyAssign = funcWriter.body.writeAssignmentStatement();
          copyAssign.ref.writePropertyAccess(field.result!.identifierToken).source.writeVariableReference(mappedArgVar);
          copyAssign.value.writePropertyAccess(rawField).source.writeVariableReference(rawArgVar.result!);
        });
        fieldIndex++;
      }
    } else if (paramIndex === 1) {
      // TODO: Fix uint.
      // const argVar = functionBlock.mapTempIdentifier(param.identifier, this.uintType);
      // params.push({ var: argVar, attribs: [ { key: CodeAttributeKey.GpuBindVertexIndex } ] });
    } else if (paramIndex === 2) {
      optionsGpuBindings = makeGpuBindings.bind(this)(this.resolveType(param.type, { inBlock: functionBlock }));
      const argVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
      argVar.requiresDirectAccess = true;
      for (const binding of optionsGpuBindings.bindings) {
        if (binding.type === 'fixed') {
          const marshalParamType = binding.marshalStructType;
          const uniformVar = this.writer.global.scope.allocateVariableIdentifier(marshalParamType.storageType, BopIdentifierPrefix.Local, param.identifier);
          rewriterFuncs.push((funcWriter) => {
            // argVar.result = funcWriter.body.scope.allocateVariableIdentifier(CodeTypeSpec.boolType, 'asdf', 'asdf');
            binding.unmarshal(uniformVar, funcWriter.body, argVar);
          });

          const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
          const bindingLocation = isGpuVertexFunc ? CodeAttributeKey.GpuVertexBindingLocation : CodeAttributeKey.GpuFragmentBindingLocation;
          varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
          varWriter.attribs.push({ key: CodeAttributeKey.GpuVarUniform });

          rewriterFuncs.push((funcWriter) => {
            const placeholderAssign = funcWriter.body.writeAssignmentStatement();
            placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
            placeholderAssign.value.writeIdentifier(uniformVar.identifierToken);
          });
        } else if (binding.type === 'array') {
          const userElementType = binding.userType;
          const userParamType = userElementType.storageType.toArray();
          const uniformVar = this.writer.global.scope.allocateVariableIdentifier(userParamType, BopIdentifierPrefix.Local, param.identifier);
          rewriterFuncs.push((funcWriter) => {
            binding.unmarshal(uniformVar, funcWriter.body, argVar);
          });

          const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
          const bindingLocation = isGpuVertexFunc ? CodeAttributeKey.GpuVertexBindingLocation : CodeAttributeKey.GpuFragmentBindingLocation;
          varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
          varWriter.attribs.push({ key: CodeAttributeKey.GpuVarReadWriteArray });

          rewriterFuncs.push((funcWriter) => {
            const placeholderAssign = funcWriter.body.writeAssignmentStatement();
            placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
            placeholderAssign.value.writeVariableReferenceReference(uniformVar.identifierToken);
          });
        }
      }
    }
    paramIndex++;
  }
  const paramRewriter: FuncMutatorFunc = (funcWriter) => {
    for (const rewriter of rewriterFuncs) {
      rewriter(funcWriter);
    }
  };

  // Grrr... WebGPU disallows empty structs.
  if (vertexStructWriter.body.fieldCount === 0) {
    vertexStructWriter.body.writeField(vertexStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
  }
  // if (insStructWriter.body.fieldCount === 0) {
  //   insStructWriter.body.writeField(insStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
  // }

  return { returnType, paramRewriter, paramDecls, params, gpuBindings: optionsGpuBindings };
}











export function bopShaderBinding(this: BopProcessor, node: ts.CallExpression): BopStage|undefined {
  // Hacky special cases!!! These are necessary for now since specialized
  // generics handling, like vararg expansions are not supported.
  const isOurs =
      ts.isCallExpression(node.expression) &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression.expression) &&
      this.tc.getTypeAtLocation(node.expression.expression.expression.expression)?.symbol?.name === 'GpuStatic' &&
      node.expression.expression.expression.name.text === 'renderElements';
  if (!isOurs) {
    return;
  }

  const fragmentCallNode = node;
  const vertexCallNode = node.expression;
  const renderElementsCallNode = node.expression.expression;
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

  const fragmentArgBops = fragmentCallNode.arguments.map(arg => this.visitChild(arg));
  const vertexArgBops =  vertexCallNode.arguments.map(arg => this.visitChild(arg));

  const renderElementsArgs = renderElementsCallNode.arguments;
  if (renderElementsArgs.length !== 3) {
    this.logAssert(`Call to Gpu.renderElements takes 3 arguments (${renderElementsArgs.length} provided).`);
    return;
  }

  const primitiveCountBop = this.visitChild(renderElementsArgs[0]);
  // Prevent temporaries from getting created. We only need the names, not
  // references, since these will be GPU only.
  const oldAsAssignableRef = this.asAssignableRef;
  this.asAssignableRef = true;
  const vertexFunctionBop = this.visitChild(renderElementsArgs[1]);
  const fragmentFunctionBop = this.visitChild(renderElementsArgs[2]);
  this.asAssignableRef = oldAsAssignableRef;

  return {
    resolveIdentifiers: () => {},
    produceResult: () => {
      // Resolve vertex function.
      // Emit a wrapper GPU vertex function.
      const vertexFunctionExprResult = this.readFullResult(vertexFunctionBop);
      const vertexFunctionConcreteImpl = vertexFunctionExprResult?.expressionResult?.bopType.functionOf?.concreteImpl;
      const fragmentFunctionExprResult = this.readFullResult(fragmentFunctionBop);
      const fragmentFunctionConcreteImpl = fragmentFunctionExprResult?.expressionResult?.bopType.functionOf?.concreteImpl;
      if (!this.verifyNotNulllike(vertexFunctionConcreteImpl, `Vertex shader is not concrete.`) ||
          !this.verifyNotNulllike(vertexFunctionConcreteImpl.bopVar.result, `Vertex shader is not complete.`) ||
          !this.verifyNotNulllike(fragmentFunctionConcreteImpl, `Fragment shader is not concrete.`) ||
          !this.verifyNotNulllike(fragmentFunctionConcreteImpl.bopVar.result, `Fragment shader is not complete.`)) {
        return;
      }

      const pipelineName = 'DrawTriangle';
      // Do _not_ mark references, as they are referenced indirectly.
      const vertexFuncIdentifier = vertexFunctionConcreteImpl.bopVar.result.identifierToken;
      vertexFunctionConcreteImpl.touchedByGpu = true;
      const fragmentFuncIdentifier = fragmentFunctionConcreteImpl.bopVar.result.identifierToken;
      fragmentFunctionConcreteImpl.touchedByGpu = true;

      const pipelineInstanceVar = this.instanceScope.allocateVariableIdentifier(this.privateTypes.MTLRenderPipelineDescriptor.storageType, BopIdentifierPrefix.Field, `${pipelineName}_pipeline`);
      this.instanceBlockWriter.body.writeField(pipelineInstanceVar.identifierToken, this.privateTypes.MTLRenderPipelineDescriptor.storageType);
      const renderPassDescriptorInstanceVar = this.instanceScope.allocateVariableIdentifier(this.privateTypes.MTLRenderPassDescriptor.storageType, BopIdentifierPrefix.Field, `${pipelineName}_renderPassDescriptor`);
      this.instanceBlockWriter.body.writeField(renderPassDescriptorInstanceVar.identifierToken, this.privateTypes.MTLRenderPassDescriptor.storageType);

      const vertexFunctionInstanceVar = this.instanceScope.allocateVariableIdentifier(this.privateTypes.MTLFunction.storageType, BopIdentifierPrefix.Field, `${pipelineName}_vertexShader`);
      this.instanceBlockWriter.body.writeField(vertexFunctionInstanceVar.identifierToken, this.privateTypes.MTLFunction.storageType);
      const fragmentFunctionInstanceVar = this.instanceScope.allocateVariableIdentifier(this.privateTypes.MTLFunction.storageType, BopIdentifierPrefix.Field, `${pipelineName}_fragmentShader`);
      this.instanceBlockWriter.body.writeField(fragmentFunctionInstanceVar.identifierToken, this.privateTypes.MTLFunction.storageType);

      // Resolve fragment function.
      // Emit a wrapper GPU fragment function.

      // Emit pipeline setup code, and store the pipeline in globals.
      {
        const initFuncIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, `${pipelineName}_prepare`);
        const initFuncBlock = this.globalBlock.createChildBlock(CodeScopeType.Function);
        const initFuncScope = this.writer.global.scope.createChildScope(CodeScopeType.Function);
        const initFunc = this.writer.global.writeFunction(initFuncIdentifier.identifierToken);
        initFunc.touchedByCpu = true;
        initFunc.returnTypeSpec = this.voidType.tempType;
        this.prepareFuncs.push(initFuncIdentifier);
        const blockWriter = initFunc.body;

        const allocTmpOut = (bopType: BopType): CodeVariable => {
          const outBopVar = initFuncBlock.mapIdentifier('tmp', bopType.tempType, bopType, /* anonymous */ true);
          const outVar = blockWriter.scope.createVariableInScope(outBopVar.type, pipelineName);
          outBopVar.result = outVar;
          return outVar;
        };

        // id<MTLFunction> vertexFunction = [defaultLibrary newFunctionWithName:@"drawTriangle1_vertexShader"];
        const vertexFunctionVar = allocTmpOut(this.privateTypes.MTLFunction);
        const vertexFunction = blockWriter.writeVariableDeclaration(vertexFunctionVar);
        const vertexFunctionInit = vertexFunction.initializer.writeExpression().writeStaticFunctionCall(this.writer.makeInternalToken('MTLLibraryNewFunctionWithName'));
        vertexFunctionInit.addArg().writeLiteralStringToken(vertexFuncIdentifier, { managed: true });

        // id<MTLFunction> fragmentFunction = [defaultLibrary newFunctionWithName:@"drawTriangle1_fragmentShader"];
        const fragmentFunctionVar = allocTmpOut(this.privateTypes.MTLFunction);
        const fragmentFunction = blockWriter.writeVariableDeclaration(fragmentFunctionVar);
        const fragmentFunctionInit = fragmentFunction.initializer.writeExpression().writeStaticFunctionCall(this.writer.makeInternalToken('MTLLibraryNewFunctionWithName'));
        fragmentFunctionInit.addArg().writeLiteralStringToken(fragmentFuncIdentifier, { managed: true });

        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(vertexFunctionInstanceVar.identifierToken).source.writeVariableReference(this.instanceVarsIdentifier);
          assign.value.writeVariableReference(vertexFunctionVar);
        }
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(fragmentFunctionInstanceVar.identifierToken).source.writeVariableReference(this.instanceVarsIdentifier);
          assign.value.writeVariableReference(fragmentFunctionVar);
        }

        // MTLRenderPipelineDescriptor* pipelineStateDescriptor = [[MTLRenderPipelineDescriptor alloc] init];
        const pipelineStateDescriptorVar = allocTmpOut(this.privateTypes.MTLRenderPipelineDescriptor);
        const pipelineStateDescriptor = blockWriter.writeVariableDeclaration(pipelineStateDescriptorVar);
        const pipelineStateDescriptorInit = pipelineStateDescriptor.initializer.writeExpression().writeStaticFunctionCall(this.writer.makeInternalToken('MakeMTLRenderPipelineDescriptor'));

        // pipelineStateDescriptor.label = @"RenderPrimitives";
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(this.writer.makeInternalToken('label')).source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeLiteralString('RenderPrimitives', { managed: true });
        }
        // pipelineStateDescriptor.vertexFunction = vertexFunction;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(this.writer.makeInternalToken('vertexFunction')).source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeVariableReference(vertexFunctionVar);
        }
        // pipelineStateDescriptor.fragmentFunction = fragmentFunction;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(this.writer.makeInternalToken('fragmentFunction')).source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeVariableReference(fragmentFunctionVar);
        }
        // pipelineStateDescriptor.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm_sRGB;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('pixelFormat'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLPixelFormatBGRA8Unorm_sRGB'));
        }
        // pipelineStateDescriptor.colorAttachments[0].blendingEnabled = true;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('blendingEnabled'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeLiteralBool(true);
        }
        // pipelineStateDescriptor.colorAttachments[0].alphaBlendOperation = MTLBlendOperationAdd;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('alphaBlendOperation'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendOperationAdd'));
        }
        // pipelineStateDescriptor.colorAttachments[0].rgbBlendOperation = MTLBlendOperationAdd;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('rgbBlendOperation'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendOperationAdd'));
        }
        // pipelineStateDescriptor.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOne;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('destinationAlphaBlendFactor'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorOne'));
        }
        // pipelineStateDescriptor.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOne;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('destinationRGBBlendFactor'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorOne'));
        }
        // pipelineStateDescriptor.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('sourceAlphaBlendFactor'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorOne'));
        }
        // pipelineStateDescriptor.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('sourceRGBBlendFactor'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorSourceAlpha'));
        }
        // drawTriangle1_pipeline1 = [device newRenderPipelineStateWithDescriptor:pipelineStateDescriptor error:&error];
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(pipelineInstanceVar.identifierToken).source.writeVariableReference(this.instanceVarsIdentifier);
          const call = assign.value.writeStaticFunctionCall(this.writer.makeInternalToken('MTLNewRenderPipelineStateWithDescriptor'));
          call.addArg().writeVariableReference(pipelineStateDescriptorVar);
        }
        // MTLRenderPassDescriptor* renderPassDescriptor = [MTLRenderPassDescriptor new];
        const renderPassDescriptorVar = allocTmpOut(this.privateTypes.MTLRenderPassDescriptor);
        const renderPassDescriptor = blockWriter.writeVariableDeclaration(renderPassDescriptorVar);
        const renderPassDescriptorInit = renderPassDescriptor.initializer.writeExpression().writeStaticFunctionCall(this.writer.makeInternalToken('MakeMTLRenderPassDescriptor'));
        // renderPassDescriptor.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('clearColor'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(renderPassDescriptorVar);
          const call = assign.value.writeStaticFunctionCall(this.writer.makeInternalToken('MTLClearColorMake'));
          call.addArg().writeLiteralFloat(0);
          call.addArg().writeLiteralFloat(0);
          call.addArg().writeLiteralFloat(0);
          call.addArg().writeLiteralFloat(0);
        }
        // renderPassDescriptor.colorAttachments[0].loadAction = MTLLoadActionClear;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('loadAction'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(renderPassDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLLoadActionClear'));
        }
        // renderPassDescriptor.colorAttachments[0].storeAction = MTLStoreActionStore;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('storeAction'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(renderPassDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLStoreActionStore'));
        }
        // drawTriangle1_renderPassDescriptor1 = renderPassDescriptor;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(renderPassDescriptorInstanceVar.identifierToken).source.writeVariableReference(this.instanceVarsIdentifier);
          assign.value.writeVariableReference(renderPassDescriptorVar);
        }
      }


      {
        const allocTmpOut = (bopType: BopType): CodeVariable => {
          const outBopVar = this.block.mapIdentifier('tmp', bopType.tempType, bopType, /* anonymous */ true);
          const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, getNodeLabel(node));
          outBopVar.result = outVar;
          return outVar;
        };

        // auto positions = generateTriangleVertices(10);
        // const positionsVar = allocTmpOut(this.functionType);
        const positionsVar = this.readResult(vertexArgBops[0]).result!;
        const vertexOptionsBopVar = this.readResult(vertexArgBops[1]);
        const fragmentOptionsBopVar = this.readResult(fragmentArgBops[0]);

        // Texture renderTarget = AllocatePersistentTexture(GetTrackTextureFormat(), /* salt */ 12345678);
        const renderTargetVar = allocTmpOut(this.privateTypes.Texture);
        const renderTarget = this.blockWriter.writeVariableDeclaration(renderTargetVar);
        const renderTargetInit = renderTarget.initializer.writeExpression().writeStaticFunctionCall(this.writer.makeInternalToken('AllocatePersistentTexture'));
        renderTargetInit.addArg().writeStaticFunctionCall(this.writer.makeInternalToken('GetTrackTextureFormat'));
        renderTargetInit.addArg().writeLiteralInt(12345678);

        // Metadata_drawTriangle1_vertexShader metadata = {};
        // Metadata_drawTriangle1_fragmentShader metadata = {};



        // MTLRenderPassDescriptor* renderPassDescriptor = drawTriangle1_renderPassDescriptor1;
        const renderPassDescriptorVar = allocTmpOut(this.privateTypes.MTLRenderPassDescriptor);
        const renderPassDescriptor = this.blockWriter.writeVariableDeclaration(renderPassDescriptorVar);
        const renderPassDescriptorInit = renderPassDescriptor.initializer.writeExpression().writePropertyAccess(renderPassDescriptorInstanceVar.identifierToken).source.writeVariableReference(this.instanceVarsIdentifier);
        // renderPassDescriptor.colorAttachments[0].texture = renderTarget;
        {
          const assign = this.blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('texture'))
              .source.writeIndexAccess({ indexLiteral: 0 })
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(renderPassDescriptorVar);
          assign.value.writeVariableReference(renderTargetVar);
        }
        // id<MTLRenderCommandEncoder> encoder = [GetCurrentCommandBuffer() renderCommandEncoderWithDescriptor:renderPassDescriptor];
        const encoderVar = allocTmpOut(this.privateTypes.MTLRenderCommandEncoder);
        const encoder = this.blockWriter.writeVariableDeclaration(encoderVar);
        const encoderInit = encoder.initializer.writeExpression().writeStaticFunctionCall(this.writer.makeInternalToken('MakeMTLRenderCommandEncoder'));
        encoderInit.addArg().writeVariableReference(renderPassDescriptorVar);
        // encoder.label = @"RenderPrimitives";
        {
          const assign = this.blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(this.writer.makeInternalToken('label')).source.writeVariableReference(encoderVar);
          assign.value.writeLiteralString('RenderPrimitives', { managed: true });
        }
        // [encoder setCullMode:MTLCullModeNone];
        {
          const assign = this.blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(this.writer.makeInternalToken('cullMode')).source.writeVariableReference(encoderVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLCullModeNone'));
        }
        // [encoder setRenderPipelineState:drawTriangle1_pipeline1];
        {
          const assign = this.blockWriter.writeAssignmentStatement();
          assign.ref.writePropertyAccess(this.writer.makeInternalToken('renderPipelineState')).source.writeVariableReference(encoderVar);
          assign.value.writePropertyAccess(pipelineInstanceVar.identifierToken).source.writeVariableReference(this.instanceVarsIdentifier);
        }

        // [encoder setVertexBytes:&vertexMetadata length:sizeof(vertexMetadata) atIndex:0];
        // [encoder setVertexBuffer:position.GpuBuffer() offset:0 atIndex:1];
        {
          const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken('EncoderSetVertexBuffer'));
          call.addArg().writeVariableReference(encoderVar);
          call.addArg().writeVariableReference(positionsVar);
          call.addArg().writeLiteralInt(0);
          call.addArg().writeLiteralInt(0);
        }
        // [encoder setVertexBytes:&vertexOptions length:sizeof(vertexOptions) atIndex:2];

        const bindBindings = (kernelImpl: BopFunctionConcreteImplDetail, dataVar: CodeVariable, stage: 'Vertex'|'Fragment') => {
          const bindings = kernelImpl.gpuBindings;
          if (!this.verifyNotNulllike(bindings, `Expected GPU bindings for ${stage} function, but none were found.`)) {
            return;
          }
          for (const binding of bindings.bindings) {
            if (binding.type === 'fixed') {
              var bufferFillerVar = this.blockWriter.scope.allocateVariableIdentifier(this.privateTypes.BufferFiller.tempType, BopIdentifierPrefix.Local, 'bufferFiller');
              console.log(this.privateTypes.BufferFiller);
              const stmt = this.blockWriter.writeVariableDeclaration(bufferFillerVar);
              stmt.initializer.writeAssignStructField(this.writer.makeInternalToken('byteLength')).value.writeLiteralInt(binding.byteLength);
              binding.marshal(dataVar, new BufferFiller(this, bufferFillerVar), this.blockWriter);

              const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken(`EncoderSet${stage}Bytes`));
              call.addArg().writeVariableReference(encoderVar);
              call.addArg().writeMethodCall(this.writer.makeInternalToken('getBuffer')).source.writeVariableReference(bufferFillerVar);
              call.addArg().writeLiteralInt(0);
              call.addArg().writeLiteralInt(binding.location);
            } else if (binding.type === 'array') {
              var bufferFillerVar = this.blockWriter.scope.allocateVariableIdentifier(this.privateTypes.BufferFiller.tempType, BopIdentifierPrefix.Local, 'bufferFiller');
              console.log(this.privateTypes.BufferFiller);
              const stmt = this.blockWriter.writeVariableDeclaration(bufferFillerVar);
              const bufferLengthExpr = stmt.initializer.writeAssignStructField(this.writer.makeInternalToken('byteLength')).value.writeBinaryOperation(CodeBinaryOperator.Multiply);
              bufferLengthExpr.lhs.writeLiteralInt(binding.elementMarshalBinding.byteLength);
              binding.writeGetLength(dataVar, bufferLengthExpr.rhs);
              binding.marshal(dataVar, new BufferFiller(this, bufferFillerVar), this.blockWriter);

              const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken(`EncoderSet${stage}Bytes`));
              call.addArg().writeVariableReference(encoderVar);
              call.addArg().writeMethodCall(this.writer.makeInternalToken('getBuffer')).source.writeVariableReference(bufferFillerVar);
              call.addArg().writeLiteralInt(0);
              call.addArg().writeLiteralInt(binding.location);
            }
          }
        };

        bindBindings(vertexFunctionConcreteImpl, vertexOptionsBopVar.result!, 'Vertex');
        bindBindings(fragmentFunctionConcreteImpl, fragmentOptionsBopVar.result!, 'Fragment');
        // {
        //   const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken('EncoderSetFragmentBytes'));
        //   call.addArg().writeVariableReference(encoderVar);
        //   call.addArg().writeVariableReference(fragmentOptionsVar);
        //   call.addArg().writeLiteralInt(0);
        //   call.addArg().writeLiteralInt(0);
        // }
        // [encoder setFragmentBytes:&fragmentMetadata length:sizeof(fragmentMetadata) atIndex:0];
        // [encoder setFragmentBytes:&fragmentOptions length:sizeof(fragmentOptions) atIndex:1];

        // [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:(uint)(positions.GetCount())];
        {
          const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken('EncoderDrawPrimitives'));
          call.addArg().writeVariableReference(encoderVar);
          call.addArg().writeIdentifier(this.writer.makeInternalToken('MTLPrimitiveTypeTriangle'));
          call.addArg().writeLiteralInt(0);
          call.addArg().writeVariableReference(this.readResult(primitiveCountBop).result!);
        }
        // [encoder endEncoding];
        {
          const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken('EncoderEndEncoding'));
          call.addArg().writeVariableReference(encoderVar);
        }
        // return renderTarget;
        {
          const ret = this.blockWriter.writeReturnStatement();
          ret.expr.writeVariableReference(renderTargetVar);
        }
      }


      // Allocate/resize persistent output texture.
      // Bind vertex stage buffers.
      // Bind fragment stage buffers.
      // Queue render command.
      const outBopVar = this.block.mapIdentifier('tmp', this.privateTypes.MTLFunction.tempType, this.privateTypes.MTLFunction, /* anonymous */ true);
      const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, pipelineName);
      outBopVar.result = outVar;

      const newVar = this.blockWriter.writeVariableDeclaration(outVar);
      newVar.initializer.writeExpression().writeLiteralInt(1234);
      return { expressionResult: outBopVar };
    },
  };
}