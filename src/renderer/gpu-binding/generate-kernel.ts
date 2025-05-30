import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodeAttributeDecl, CodeAttributeKey, CodeNamedToken, CodePrimitiveType, CodeScopeType, CodeTypeSpec, CodeVariable } from "../code-writer/code-writer";
import { BapControlFlowScopeType, BapGpuKernelScope, BapPrototypeScope, BapReturnValueSymbol } from '../bap-scope';
import { BapSubtreeGenerator, BapGenerateContext, BapTypeSpec } from '../bap-value';
import { BapVariableDeclarationVisitor } from '../baps/variable-declaration';
import { BapIdentifierPrefix } from '../bap-constants';
import { makeGpuBindings } from '../gpu-binding/make-bindings';
import { resolveBapFields } from '../bap-utils';
import { GpuBindings, GpuFixedBinding } from '../gpu-binding/gpu-bindings';
import { BapPropertyAccessExpressionVisitor } from '../baps/property-access-expression';
import { BapIdentifierExpressionVisitor } from '../baps/identifier-expression';


/** Emits the function as a GPU compatible function, which reads appropriate shader uniforms. */
export function makeKernelGenerator(this: BapVisitor, node: ts.FunctionDeclaration) {
  if (!this.verifyNotNulllike(node.name, `Unsupported anonymous function at global scope.`)) {
    return;
  }
  if (!this.verifyNotNulllike(node.body, `Function at global scope must have a body.`)) {
    return;
  }
  const funcBody = node.body;
  const functionName = node.name.text;

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

  const returnVarVisitor = new BapVariableDeclarationVisitor();
  const returnVarGen = returnVarVisitor.manual({ newVars: [
    {
      identifier: BapReturnValueSymbol,
      type: this.types.type(returnType),
    }
  ] });
  const returnValueGen = new BapIdentifierExpressionVisitor().manual({ identifierName: BapReturnValueSymbol })!;



  const generateGpuKernel = (context: BapGenerateContext): { token: CodeNamedToken; bindings: GpuBindings; }|undefined => {
    console.log('generateGpuKernel', functionName);
    const body = this.child(funcBody);
    const basics = this.types.basic(context);

    // TODO: HAXXORZZZ !!!!!
    const isGpuComputeFunc = functionName.includes('computeShader');
    const isGpuVertexFunc = functionName.includes('vertexShader');
    const isGpuFragmentFunc = functionName.includes('fragmentShader');
    const isGpuBoundFunc = isGpuComputeFunc || isGpuFragmentFunc || isGpuVertexFunc;
    if (!isGpuBoundFunc) {
      return;
    }
    const gpuKernelScope: BapGpuKernelScope =
        isGpuComputeFunc ? BapGpuKernelScope.Compute :
        isGpuVertexFunc ? BapGpuKernelScope.Vertex :
        BapGpuKernelScope.Fragment;

    const kernelIdentifier = context.globalWriter.global.scope.allocateIdentifier(BapIdentifierPrefix.Function, functionName);
    const kernelFunc = context.globalWriter.global.writeFunction(kernelIdentifier);
    kernelFunc.touchedByGpu = true;
    if (isGpuComputeFunc) {
      kernelFunc.addAttribute({ key: CodeAttributeKey.GpuFunctionCompute });
      kernelFunc.addAttribute({ key: CodeAttributeKey.GpuWorkgroupSize, intValue: 64 });
    }
    if (isGpuVertexFunc) {
      kernelFunc.addAttribute({ key: CodeAttributeKey.GpuFunctionVertex });
    }
    if (isGpuFragmentFunc) {
      kernelFunc.addAttribute({ key: CodeAttributeKey.GpuFunctionFragment });
      kernelFunc.addReturnAttribute({ key: CodeAttributeKey.GpuBindLocation, intValue: 0 });
    }
    const bindingLocation = isGpuVertexFunc ? CodeAttributeKey.GpuVertexBindingLocation : isGpuFragmentFunc ? CodeAttributeKey.GpuFragmentBindingLocation : CodeAttributeKey.GpuComputeBindingLocation;
    const prepare = kernelFunc.body;


    {
      const placeholderAssign = prepare.writeAssignmentStatement();
      placeholderAssign.ref.writeIdentifier(context.globalWriter.underscoreToken);
      placeholderAssign.value.writeVariableReferenceReference(context.globalWriter.makeInternalToken('BopLib_DebugIns_ValuesArray'));
    }
    if (gpuKernelScope !== BapGpuKernelScope.Vertex) {
      {
        const placeholderAssign = prepare.writeAssignmentStatement();
        placeholderAssign.ref.writeIdentifier(context.globalWriter.underscoreToken);
        placeholderAssign.value.writeVariableReferenceReference(context.globalWriter.makeInternalToken('BopLib_DebugOuts_Metadata'));
      }
      {
        const placeholderAssign = prepare.writeAssignmentStatement();
        placeholderAssign.ref.writeIdentifier(context.globalWriter.underscoreToken);
        placeholderAssign.value.writeVariableReferenceReference(context.globalWriter.makeInternalToken('BopLib_DebugOuts_ValuesArray'));
      }
    }


    const childCodeScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Function);
    const childContext = context.withChildScope({ controlFlowScope: { type: BapControlFlowScopeType.Function }, gpu: { kernel: gpuKernelScope } });


    let userReturnType = this.types.type(returnType).generate(context);
    if (!this.verifyNotNulllike(userReturnType, `Shader kernel return type unknown.`)) {
      return;
    }
    const stage = isGpuComputeFunc ? 'Compute' : isGpuVertexFunc ? 'Vertex' : 'Fragment';

    let marshalReturnCodeTypeSpec = userReturnType.codeTypeSpec;

    const needsReturnValue = !isGpuComputeFunc;
    const hasCustomReturnType = true; // TODO: We only need to marshal custom structs manually.
    const hasReturnValue = userReturnType || hasCustomReturnType;
    const rawFieldAccessWriters: Array<{ marshalFieldVar: CodeVariable; accessor: (thisGen: BapSubtreeGenerator) => BapSubtreeGenerator|undefined; }> = [];
    if (needsReturnValue && !hasReturnValue) {
      this.logAssert(`${isGpuVertexFunc} output is not concrete.`);
    } else if (needsReturnValue && hasCustomReturnType && !isGpuFragmentFunc) {
      const vertexOutStructIdentifier = context.globalWriter.global.scope.allocateIdentifier(BapIdentifierPrefix.Struct, `${functionName}_${stage}Out`);
      const vertexOutStructWriter = context.globalWriter.global.writeStruct(vertexOutStructIdentifier);
      const vertexOutStructScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Class);
      vertexOutStructWriter.touchedByCpu = false;
      vertexOutStructWriter.touchedByGpu = true;

      let fieldIndex = 0;
      for (const field of resolveBapFields(userReturnType!, context)) {
        const attribs: CodeAttributeDecl[] = [];
        // TODO: MEGA HAXXOR!!!
        if (isGpuVertexFunc && field.identifier.includes('position')) {
          attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
        } else {
          attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
        }
        const rawField = vertexOutStructScope.allocateVariableIdentifier(field.type.codeTypeSpec, BapIdentifierPrefix.Field, field.identifier);
        vertexOutStructWriter.body.writeField(rawField.identifierToken, field.type.codeTypeSpec, { attribs: attribs });
        const accessor = new BapPropertyAccessExpressionVisitor();
        rawFieldAccessWriters.push({
          marshalFieldVar: rawField,
          accessor: (thisGen) => accessor.manual({ thisGen, identifierName: field.identifier }),
        });
        fieldIndex++;
      }

      // Grrr... WebGPU disallows empty structs.
      if (vertexOutStructWriter.body.fieldCount === 0) {
        vertexOutStructWriter.body.writeField(vertexOutStructScope.allocateIdentifier(BapIdentifierPrefix.Field, 'placeholder'), this.types.basic(context).int.codeTypeSpec);
      }
      marshalReturnCodeTypeSpec = CodeTypeSpec.fromStruct(vertexOutStructIdentifier);
    }


    const vertexStructIdentifier = context.globalWriter.global.scope.allocateIdentifier(BapIdentifierPrefix.Struct, `${functionName}_${stage}In`);
    const vertexStructWriter = context.globalWriter.global.writeStruct(vertexStructIdentifier);
    const vertexStructScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Class);
    vertexStructWriter.touchedByCpu = false;
    vertexStructWriter.touchedByGpu = !isGpuComputeFunc;

    const vertexParamIndex = isGpuComputeFunc ? -1 : 0;
    const threadIdParamIndex = isGpuComputeFunc ? 0 : isGpuVertexFunc ? 1 : -1;
    const optionsParamIndex = isGpuComputeFunc ? 1 : isGpuVertexFunc ? 2 : 1;

    let paramIndex = 0;
    let optionsGpuBindings: GpuBindings|undefined;
    let vertexBindings: {
      userType: BapTypeSpec;
      marshalCodeTypeSpec: CodeTypeSpec;
      rawFieldAccessWriters: Array<{ marshalFieldVar: CodeVariable; accessor: () => BapSubtreeGenerator|undefined; }>;
    }|undefined;
    let threadIdBinding: {
      userType: BapTypeSpec;
      marshalCodeTypeSpec: CodeTypeSpec;
      accessor: BapSubtreeGenerator;
    }|undefined;
    // let fixedBindings: { paramName: string; userType: BapTypeSpec; bindings: GpuFixedBinding; }|undefined;
    for (const param of parameterEntries) {
      const paramType = this.types.type(param.type).generate(context);
      paramType?.marshal?.ensureMarshalable(this);
      // paramDecls.push({ type: paramType, identifier: param.identifier });

      if (paramIndex === vertexParamIndex) {
        if (!this.verifyNotNulllike(paramType, `${isGpuVertexFunc} is not concrete.`)) {
          continue;
        }
        childContext.scope.declare(param.identifier, {
          type: 'cached',
          typeSpec: paramType,
          writeIntoExpression: (prepare) => {
            return (expr) => {
              expr.writeVariableReference(vertexUserVar);
            };
          },
        });

        const rawFieldAccessWriters: Array<{ marshalFieldVar: CodeVariable; accessor: () => BapSubtreeGenerator|undefined; }> = [];
        let fieldIndex = 0;
        for (const field of resolveBapFields(paramType, context)) {
          const attribs: CodeAttributeDecl[] = [];
          // TODO: MEGA HAXXOR!!!
          if (isGpuFragmentFunc && field.identifier.includes('position')) {
            attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
          } else {
            attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
          }
          const rawField = vertexStructScope.allocateVariableIdentifier(field.type.codeTypeSpec, BapIdentifierPrefix.Field, field.identifier);
          vertexStructWriter.body.writeField(rawField.identifierToken, field.type.codeTypeSpec, { attribs: attribs });
          const accessor: BapSubtreeGenerator = {
            generateRead: () => {
              return {
                type: 'cached',
                typeSpec: paramType,
                writeIntoExpression: (prepare) => {
                  return (expr) => {
                    expr.writePropertyAccess(rawField.identifierToken).source.writeVariableReference(vertexVar);
                  };
                }
              };
            },
          };
          rawFieldAccessWriters.push({
            marshalFieldVar: rawField,
            accessor: () => accessor,
          });
          fieldIndex++;
        }

        vertexBindings = {
          userType: paramType,
          marshalCodeTypeSpec: CodeTypeSpec.fromStruct(vertexStructIdentifier),
          rawFieldAccessWriters,
        };
      } else if (paramIndex === threadIdParamIndex) {
        if (!this.verifyNotNulllike(paramType, `${isGpuVertexFunc} is not concrete.`)) {
          continue;
        }
        const accessor: BapSubtreeGenerator = {
          generateRead: () => {
            return {
              type: 'cached',
              typeSpec: paramType,
              writeIntoExpression: (prepare) => {
                return (expr) => {
                  if (isGpuComputeFunc) {
                    expr.writeCast(paramType.codeTypeSpec).source.writePropertyAccess(context.globalWriter.makeInternalToken('x')).source.writeVariableReference(threadIdVar);
                  } else {
                    expr.writeCast(paramType.codeTypeSpec).source.writeVariableReference(threadIdVar);
                  }
                };
              }
            };
          },
        };
        threadIdBinding = {
          userType: paramType,
          marshalCodeTypeSpec: CodeTypeSpec.fromStruct(context.globalWriter.makeInternalToken(isGpuComputeFunc ? 'BopLib::uint3' : 'BopLib::uint')),
          accessor: accessor,
        };
        childContext.scope.declare(param.identifier, {
          type: 'cached',
          typeSpec: paramType,
          writeIntoExpression: (prepare) => {
            return (expr) => {
              expr.writeVariableReference(threadIdUserVar);
            };
          },
        });
      } else if (paramIndex === optionsParamIndex) {
        const optionsBopType = this.types.type(param.type).generate(context);
        if (!optionsBopType) {
          continue;
        }
        optionsGpuBindings = makeGpuBindings.bind(this)(context, optionsBopType);
        console.log(optionsGpuBindings);

        const prototypeScope = new BapPrototypeScope();
        const staticScope = new BapPrototypeScope();
        const shadowType: BapTypeSpec = {
          prototypeScope: prototypeScope,
          staticScope: staticScope,
          typeParameters: [],
          codeTypeSpec: CodeTypeSpec.compileErrorType,
          isShadow: true,
          debugName: param.identifier + '_shadow',
        };
        childContext.scope.declare(param.identifier, {
          type: 'cached',
          typeSpec: shadowType,
        });

        for (const binding of optionsGpuBindings.bindings) {
          if (binding.type === 'fixed') {
            const uniformVar = context.globalWriter.global.scope.allocateVariableIdentifier(binding.marshalStructCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'uniform');
            const varWriter = context.globalWriter.global.writeVariableDeclaration(uniformVar);
            varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
            varWriter.attribs.push({ key: CodeAttributeKey.GpuVarUniform });
            const placeholderAssign = prepare.writeAssignmentStatement();
            placeholderAssign.ref.writeIdentifier(context.globalWriter.underscoreToken);
            placeholderAssign.value.writeVariableReferenceReference(uniformVar.identifierToken);
            binding.unmarshal(uniformVar, kernelFunc.body, prototypeScope);
          } else if (binding.type === 'array') {
            const uniformVar = context.globalWriter.global.scope.allocateVariableIdentifier(binding.marshalArrayCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'uniform');
            const varWriter = context.globalWriter.global.writeVariableDeclaration(uniformVar);
            varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
            varWriter.attribs.push({ key: CodeAttributeKey.GpuVarReadWriteArray });
            const placeholderAssign = prepare.writeAssignmentStatement();
            placeholderAssign.ref.writeIdentifier(context.globalWriter.underscoreToken);
            placeholderAssign.value.writeVariableReferenceReference(uniformVar.identifierToken);
            binding.unmarshal(uniformVar, kernelFunc.body, prototypeScope);
          } else if (binding.type === 'texture') {
            const textureVar = context.globalWriter.global.scope.allocateVariableIdentifier(basics.Texture.codeTypeSpec, BapIdentifierPrefix.Local, 'uniform');
            const samplerVar = context.globalWriter.global.scope.allocateVariableIdentifier(basics.TextureSampler.codeTypeSpec, BapIdentifierPrefix.Local, 'uniform');
            {
              const varWriter = context.globalWriter.global.writeVariableDeclaration(textureVar);
              varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
              const placeholderAssign = prepare.writeAssignmentStatement();
              placeholderAssign.ref.writeIdentifier(context.globalWriter.underscoreToken);
              placeholderAssign.value.writeVariableReference(textureVar.identifierToken);
            }
            {
              const varWriter = context.globalWriter.global.writeVariableDeclaration(samplerVar);
              varWriter.attribs.push({ key: bindingLocation, intValue: binding.location + 1 });
              const placeholderAssign = prepare.writeAssignmentStatement();
              placeholderAssign.ref.writeIdentifier(context.globalWriter.underscoreToken);
              placeholderAssign.value.writeVariableReference(samplerVar.identifierToken);
            }
            binding.unmarshal(textureVar, samplerVar, kernelFunc.body, prototypeScope);
          }
        }
      }
      paramIndex++;
    }




    kernelFunc.returnTypeSpec = marshalReturnCodeTypeSpec;



    const kernelParams = [];
    const vertexVar = childCodeScope.allocateVariableIdentifier(vertexBindings?.marshalCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'vertex');
    const vertexUserVar = childCodeScope.allocateVariableIdentifier(vertexBindings?.userType.codeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'vertex');
    const threadIdVar = childCodeScope.allocateVariableIdentifier(threadIdBinding?.marshalCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'threadId');
    const threadIdUserVar = childCodeScope.allocateVariableIdentifier(threadIdBinding?.userType.codeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'threadId');
    if (vertexBindings) {
      kernelParams.push({ index: vertexParamIndex, typeSpec: vertexVar.typeSpec, codeVar: vertexVar, attribs: [] });
      const vertexUserInit = prepare.writeVariableDeclaration(vertexUserVar);
      for (const prop of vertexBindings.rawFieldAccessWriters) {
        const fieldInitExpr = vertexUserInit.initializer.writeAssignStructField(prop.marshalFieldVar.identifierToken).value;
        prop.accessor()?.generateRead(childContext).writeIntoExpression?.(prepare)?.(fieldInitExpr);
      }
    }
    if (threadIdBinding) {
      kernelParams.push({
        index: threadIdParamIndex,
        typeSpec: threadIdVar.typeSpec,
        codeVar: threadIdVar,
        attribs: [ { key: isGpuComputeFunc ? CodeAttributeKey.GpuBindThreadIndex : CodeAttributeKey.GpuBindVertexIndex } ],
      });
      const varInit = prepare.writeVariableDeclaration(threadIdUserVar);
      threadIdBinding.accessor.generateRead(childContext).writeIntoExpression?.(prepare)?.(varInit.initializer.writeExpression());
    }
    kernelParams.sort((a, b) => a.index - b.index);
    for (const kernelParam of kernelParams) {
      if (kernelParam.index < 0) {
        continue;
      }
      kernelFunc.addParam(kernelParam.typeSpec, kernelParam.codeVar.identifierToken, { attribs: kernelParam.attribs });
    }


    const returnIsVoid = userReturnType === this.types.primitiveTypeSpec(CodePrimitiveType.Void);
    const returnVarWriter = (returnIsVoid ? undefined : returnVarGen)?.generateRead(childContext);
    const callWriter = body?.generateRead(childContext);

    returnVarWriter?.writeIntoExpression?.(prepare);

    const innerBlock = prepare.writeWhileLoop();
    innerBlock.condition.writeLiteralBool(true);
    const innerPrepare = innerBlock.body;
    callWriter?.writeIntoExpression?.(innerPrepare);
    innerPrepare.writeBreakStatement();

    if (needsReturnValue) {
      const marshalReturnVar = childCodeScope.allocateVariableIdentifier(marshalReturnCodeTypeSpec, BapIdentifierPrefix.Local, 'marshalReturn');
      const marshalReturnInit = prepare.writeVariableDeclaration(marshalReturnVar);
      if (userReturnType?.libType) {
        const returnValueWriter = returnValueGen?.generateRead(childContext).writeIntoExpression?.(prepare);
        returnValueWriter?.(marshalReturnInit.initializer.writeExpression());
      } else {
        for (const prop of rawFieldAccessWriters) {
          const fieldInitExpr = marshalReturnInit.initializer.writeAssignStructField(prop.marshalFieldVar.identifierToken).value;
          prop.accessor(returnValueGen)?.generateRead(childContext).writeIntoExpression?.(prepare)?.(fieldInitExpr);
        }
      }
      prepare.writeReturnStatement().expr.writeVariableReference(marshalReturnVar);
    }
    return {
      token: kernelIdentifier,
      bindings: optionsGpuBindings ?? { bindings: [] },
    };
  };
  const generateGpuKernelOuter = (context: BapGenerateContext) => {
    let result: { token: CodeNamedToken; bindings: GpuBindings; }|undefined;
    this.asParent(() => {
      result = generateGpuKernel(context);
    });
    return result;
  };

  return generateGpuKernelOuter.bind(this);
}
