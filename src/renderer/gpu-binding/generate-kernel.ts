import ts from "typescript/lib/typescript";
import { BapVisitor } from "../bap-visitor";
import { CodeAttributeDecl, CodeAttributeKey, CodeNamedToken, CodeScopeType, CodeTypeSpec, CodeVariable } from "../code-writer/code-writer";
import { BapControlFlowScopeType, BapPrototypeScope, BapReturnValueSymbol } from '../bap-scope';
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

    const childCodeScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Function);
    const childContext = context.withChildScope({ controlFlowScope: { type: BapControlFlowScopeType.Function } });


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
    } else if (hasCustomReturnType && !isGpuFragmentFunc) {
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
    vertexStructWriter.touchedByGpu = true;

    const vertexParamIndex = isGpuComputeFunc ? -1 : 0;
    const threadIdParamIndex = isGpuComputeFunc ? 0 : isGpuVertexFunc ? 1 : -1;
    const optionsParamIndex = isGpuComputeFunc ? 1 : isGpuVertexFunc ? 2 : 1;
    const bindingLocation = isGpuVertexFunc ? CodeAttributeKey.GpuVertexBindingLocation : isGpuFragmentFunc ? CodeAttributeKey.GpuFragmentBindingLocation : CodeAttributeKey.GpuComputeBindingLocation;

    let paramIndex = 0;
    let optionsGpuBindings: GpuBindings|undefined;
    let vertexBindings: {
      userType: BapTypeSpec;
      marshalCodeTypeSpec: CodeTypeSpec;
      rawFieldAccessWriters: Array<{ marshalFieldVar: CodeVariable; accessor: () => BapSubtreeGenerator|undefined; }>;
    }|undefined;
    let fixedBindings: { paramName: string; userType: BapTypeSpec; bindings: GpuFixedBinding; }|undefined;
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

          // prototypeScope.declare(field.identifier, {
          //   gen: (bindScope) => { return ({ generateRead: () => ({
          //     type: 'eval',
          //     typeSpec: shadowType,
          //     writeIntoExpression: (prepare) => {
          //       return (expr) => {
          //         expr.writePropertyAccess(rawField).source.writeVariableReference(vertexUserVar);
          //       };
          //     },
          //   }) }); },
          //   genType: { generate: () => { return shadowType; } },
          //   token: context.globalWriter.errorToken,
          //   isField: true,
          // });
          // rewriterFuncs.push(funcWriter => {
          //   const copyAssign = funcWriter.body.writeAssignmentStatement();
          //   copyAssign.ref.writePropertyAccess(field.result!.identifierToken).source.writeVariableReference(mappedArgVar);
          //   copyAssign.value.writePropertyAccess(rawField).source.writeVariableReference(rawArgVar.result!);
          // });
          fieldIndex++;
        }

        vertexBindings = {
          userType: paramType,
          marshalCodeTypeSpec: CodeTypeSpec.fromStruct(vertexStructIdentifier),
          rawFieldAccessWriters,
        };
      } else if (paramIndex === threadIdParamIndex) {
        // TODO: Fix uint.
        // const argVar = functionBlock.mapTempIdentifier(param.identifier, this.uintType);
        // params.push({ var: argVar, attribs: [ { key: CodeAttributeKey.GpuBindVertexIndex } ] });
      } else if (paramIndex === optionsParamIndex) {
        const optionsBopType = this.types.type(param.type).generate(context);
        if (!optionsBopType) {
          continue;
        }
        // if (optionsBopType.structOf) {
        //   // HACK!
        //   optionsBopType.structOf.touchedByGpu = false;
        // }
        optionsGpuBindings = makeGpuBindings.bind(this)(context, optionsBopType);
        console.log(optionsGpuBindings);

        const fixed = (optionsGpuBindings.bindings.find(b => b.type === 'fixed') as GpuFixedBinding|undefined);
        fixedBindings = fixed && {
          paramName: param.identifier,
          userType: optionsBopType,
          bindings: fixed,
        };
        // const argVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
        // argVar.requiresDirectAccess = true;
        // for (const binding of optionsGpuBindings.bindings) {
        //   if (binding.type === 'fixed') {
        //     const marshalParamType = binding.marshalStructType;
        //     const uniformVar = this.writer.global.scope.allocateVariableIdentifier(marshalParamType.storageType, BopIdentifierPrefix.Local, param.identifier);
        //     rewriterFuncs.push((funcWriter) => {
        //       // argVar.result = funcWriter.body.scope.allocateVariableIdentifier(CodeTypeSpec.boolType, 'asdf', 'asdf');
        //       binding.unmarshal(uniformVar, funcWriter.body, argVar);
        //     });

        //     const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
        //     varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
        //     varWriter.attribs.push({ key: CodeAttributeKey.GpuVarUniform });

        //     rewriterFuncs.push((funcWriter) => {
        //       const placeholderAssign = funcWriter.body.writeAssignmentStatement();
        //       placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
        //       placeholderAssign.value.writeIdentifier(uniformVar.identifierToken);
        //     });
        //   } else if (binding.type === 'array') {
        //     const userElementType = binding.userType;
        //     const userParamType = userElementType.storageType.toArray();
        //     const uniformVar = this.writer.global.scope.allocateVariableIdentifier(userParamType, BopIdentifierPrefix.Local, `${param.identifier}_${binding.nameHint}`);
        //     rewriterFuncs.push((funcWriter) => {
        //       binding.unmarshal(uniformVar, funcWriter.body, argVar);
        //     });

        //     const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
        //     varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
        //     varWriter.attribs.push({ key: CodeAttributeKey.GpuVarReadWriteArray });

        //     rewriterFuncs.push((funcWriter) => {
        //       const placeholderAssign = funcWriter.body.writeAssignmentStatement();
        //       placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
        //       placeholderAssign.value.writeVariableReferenceReference(uniformVar.identifierToken);
        //     });
        //   } else if (binding.type === 'texture') {
        //     const userParamType = this.libTypes.Texture.tempType;
        //     const uniformVar = this.writer.global.scope.allocateVariableIdentifier(userParamType, BopIdentifierPrefix.Local, `${param.identifier}_${binding.nameHint}`);
        //     rewriterFuncs.push((funcWriter) => {
        //       binding.unmarshal(uniformVar, funcWriter.body, argVar);
        //     });

        //     const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
        //     varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
        //     // varWriter.attribs.push({ key: CodeAttributeKey.GpuVarReadWriteArray });

        //     rewriterFuncs.push((funcWriter) => {
        //       const placeholderAssign = funcWriter.body.writeAssignmentStatement();
        //       placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
        //       placeholderAssign.value.writeVariableReference(uniformVar.identifierToken);
        //     });
        //   }
        // }
        // rewriterFuncs.push((funcWriter) => {
        //   const placeholderAssign = funcWriter.body.writeAssignmentStatement();
        //   placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
        //   placeholderAssign.value.writeVariableReferenceReference(this.writer.makeInternalToken('BopLib_DebugIns_ValuesArray'));
        // });
        // rewriterFuncs.push((funcWriter) => {
        //   const placeholderAssign = funcWriter.body.writeAssignmentStatement();
        //   placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
        //   placeholderAssign.value.writeVariableReferenceReference(this.writer.makeInternalToken('BopLib_DebugOuts_Metadata'));
        // });
        // // GRRR webgpu
        // if (!isGpuVertexFunc) {
        //   rewriterFuncs.push((funcWriter) => {
        //     const placeholderAssign = funcWriter.body.writeAssignmentStatement();
        //     placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
        //     placeholderAssign.value.writeVariableReferenceReference(this.writer.makeInternalToken('BopLib_DebugOuts_ValuesArray'));
        //   });
        // }
      }
      paramIndex++;
    }






    kernelFunc.returnTypeSpec = marshalReturnCodeTypeSpec;



    const prepare = kernelFunc.body;

    const kernelParams = [];
    const vertexVar = childCodeScope.allocateVariableIdentifier(vertexBindings?.marshalCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'vertex');
    const vertexUserVar = childCodeScope.allocateVariableIdentifier(vertexBindings?.userType.codeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'vertex');
    const threadIdVar = childCodeScope.allocateVariableIdentifier(CodeTypeSpec.fromStruct(context.globalWriter.makeInternalToken('BopLib::uint')), BapIdentifierPrefix.Local, 'threadId');
    const fixedVar = context.globalWriter.global.scope.allocateVariableIdentifier(fixedBindings?.bindings.marshalStructCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BapIdentifierPrefix.Local, 'fixed');
    if (vertexBindings) {
      kernelParams.push({ index: vertexParamIndex, typeSpec: vertexVar.typeSpec, codeVar: vertexVar, isUniform: false, attribs: [] });
      const vertexUserInit = prepare.writeVariableDeclaration(vertexUserVar);
      for (const prop of vertexBindings.rawFieldAccessWriters) {
        const fieldInitExpr = vertexUserInit.initializer.writeAssignStructField(prop.marshalFieldVar.identifierToken).value;
        prop.accessor()?.generateRead(childContext).writeIntoExpression?.(prepare)?.(fieldInitExpr);
      }
    }
    kernelParams.push({
      index: threadIdParamIndex,
      typeSpec: threadIdVar.typeSpec,
      codeVar: threadIdVar,
      isUniform: false,
      attribs: [ { key: CodeAttributeKey.GpuBindVertexIndex } ],
    });
    if (fixedBindings) {
      kernelParams.push({ index: optionsParamIndex, typeSpec: fixedVar.typeSpec, codeVar: fixedVar, isUniform: true, attribs: [ { key: bindingLocation, intValue: 0 } ] });

      const prototypeScope = new BapPrototypeScope();
      const staticScope = new BapPrototypeScope();
      const shadowType: BapTypeSpec = {
        prototypeScope: prototypeScope,
        staticScope: staticScope,
        typeParameters: [],
        codeTypeSpec: fixedBindings.userType.codeTypeSpec,
        isShadow: true,
        debugName: fixedBindings.userType.debugName + '_shadow',
      };
      childContext.scope.declare(fixedBindings.paramName, {
        type: 'cached',
        typeSpec: shadowType,
      });

      fixedBindings.bindings.unmarshal(fixedVar, kernelFunc.body, prototypeScope);
    }
    kernelParams.sort((a, b) => a.index - b.index);
    for (const kernelParam of kernelParams) {
      if (kernelParam.index < 0) {
        continue;
      }
      if (kernelParam.isUniform) {
        const varWriter = context.globalWriter.global.writeVariableDeclaration(kernelParam.codeVar);
        varWriter.attribs.push(...kernelParam.attribs);
        varWriter.attribs.push({ key: CodeAttributeKey.GpuVarUniform });
      } else {
        kernelFunc.addParam(kernelParam.typeSpec, kernelParam.codeVar.identifierToken, { attribs: kernelParam.attribs });
      }
    }


    const returnVarWriter = returnVarGen?.generateRead(childContext);
    const callWriter = body?.generateRead(childContext);

    returnVarWriter?.writeIntoExpression?.(prepare);

    const innerBlock = prepare.writeWhileLoop();
    innerBlock.condition.writeLiteralBool(true);
    const innerPrepare = innerBlock.body;
    callWriter?.writeIntoExpression?.(innerPrepare);
    innerPrepare.writeBreakStatement();

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
