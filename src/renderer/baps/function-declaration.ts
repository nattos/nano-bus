import * as utils from '../../utils';
import ts from "typescript/lib/typescript";
import { BapVisitor, BapVisitorRootContext } from "../bap-visitor";
import { CodeAttributeDecl, CodeAttributeKey, CodeBinaryOperator, CodePrimitiveType, CodeScopeType, CodeTypeSpec, CodeVariable } from "../code-writer";
import { getNodeLabel } from "../ts-helpers";
import { BapControlFlowScopeType, BapPrototypeScope, BapReturnValueSymbol, BapScope, BapThisSymbol } from '../bap-scope';
import { BapSubtreeGenerator, BapFunctionLiteral, BapSubtreeValue, BapTypeLiteral, BapGenerateContext, BapTypeSpec, BapFields } from '../bap-value';
import { BapVariableDeclarationVisitor } from './variable-declaration';
import { BopIdentifierPrefix } from '../bop-data';
import { GpuBindings, GpuFixedBinding, makeGpuBindings, resolveBapFields } from './call-expression';
import { BapPropertyAccessExpressionVisitor } from './property-access-expression';
import { BapIdentifierExpressionVisitor } from './identifier-expression';

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

    const result: BapSubtreeGenerator = {
      generateRead: (context) => {
        const body = this.child(funcBody);
        const funcLiteral: BapFunctionLiteral = {
          type: 'function',
          typeSpec: this.types.primitiveTypeSpec(CodePrimitiveType.Function),
          resolve: (args: BapSubtreeValue[], typeArgs: BapTypeSpec[]) => {
            // TODO: Perform overload resolution and generic template expansion.
            const childContext = context.withChildScope({ controlFlowScope: { type: BapControlFlowScopeType.Function } });
            for (let i = 0; i < parameterEntries.length; ++i) {
              const parameterSignature = parameterEntries[i];
              const argValue = args.at(i) ?? { type: 'error' };
              // TODO: Sometimes pass copy!!!
              childContext.scope.declare(parameterSignature.identifier, argValue);
            }

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
          generateGpuKernel: () => {
            console.log('generateGpuKernel', functionName);
            const basics = this.types.basic(context);

            const kernelIdentifier = context.globalWriter.global.scope.allocateIdentifier(BopIdentifierPrefix.Function, functionName);
            const kernelFunc = context.globalWriter.global.writeFunction(kernelIdentifier);
            kernelFunc.touchedByGpu = true;

            const childCodeScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Function);
            const childContext = context.withChildScope({ controlFlowScope: { type: BapControlFlowScopeType.Function } });




            let userReturnType = this.types.type(returnType).generate(context);
            if (!this.verifyNotNulllike(userReturnType, `Shader kernel return type unknown.`)) {
              return;
            }

            // const paramDecls: BapFields = [];
            // const params: { var: BopVariable, attribs?: CodeAttributeDecl[] }[] = [];
            // TODO: HAXXORZZZ !!!!!
            const isGpuComputeFunc = functionName.includes('computeShader');
            const isGpuVertexFunc = functionName.includes('vertexShader');
            const isGpuFragmentFunc = functionName.includes('fragmentShader');
            const isGpuBoundFunc = isGpuComputeFunc || isGpuFragmentFunc || isGpuVertexFunc;
            if (!isGpuBoundFunc) {
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
              const vertexOutStructIdentifier = context.globalWriter.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${functionName}_${stage}Out`);
              const vertexOutStructWriter = context.globalWriter.global.writeStruct(vertexOutStructIdentifier);
              const vertexOutStructScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Class);
              vertexOutStructWriter.touchedByCpu = false;
              vertexOutStructWriter.touchedByGpu = true;

              let fieldIndex = 0;
              this.asParent(() => {
                for (const field of resolveBapFields(userReturnType!, context)) {
                  const attribs: CodeAttributeDecl[] = [];
                  // TODO: MEGA HAXXOR!!!
                  if (isGpuVertexFunc && field.identifier.includes('position')) {
                    attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
                  } else {
                    attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
                  }
                  const rawField = vertexOutStructScope.allocateVariableIdentifier(field.type.codeTypeSpec, BopIdentifierPrefix.Field, field.identifier);
                  vertexOutStructWriter.body.writeField(rawField.identifierToken, field.type.codeTypeSpec, { attribs: attribs });
                  const accessor = new BapPropertyAccessExpressionVisitor();
                  rawFieldAccessWriters.push({
                    marshalFieldVar: rawField,
                    accessor: (thisGen) => accessor.manual({ thisGen, identifierName: field.identifier }),
                  });
                  fieldIndex++;
                }
              });

              // Grrr... WebGPU disallows empty structs.
              if (vertexOutStructWriter.body.fieldCount === 0) {
                vertexOutStructWriter.body.writeField(vertexOutStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.types.basic(context).int.codeTypeSpec);
              }
              marshalReturnCodeTypeSpec = CodeTypeSpec.fromStruct(vertexOutStructIdentifier);
            }


const vertexStructIdentifier = context.globalWriter.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${functionName}_${stage}In`);
const vertexStructWriter = context.globalWriter.global.writeStruct(vertexStructIdentifier);
const vertexStructScope = context.globalWriter.global.scope.createChildScope(CodeScopeType.Class);
vertexStructWriter.touchedByCpu = false;
vertexStructWriter.touchedByGpu = true;
// const vertexStructType = BopType.createPassByValue({
//   debugName: `${funcName}_${isGpuVertexFunc}`,
//   valueType: CodeTypeSpec.fromStruct(vertexStructIdentifier),
//   innerScope: vertexStructScope,
//   innerBlock: vertexStructBlock,
// });

const vertexParamIndex = isGpuComputeFunc ? -1 : 0;
const threadIdParamIndex = isGpuComputeFunc ? 0 : 1;
const optionsParamIndex = isGpuComputeFunc ? 1 : 2;
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
  // paramDecls.push({ type: paramType, identifier: param.identifier });

  if (paramIndex === vertexParamIndex) {
    if (!this.verifyNotNulllike(paramType, `${isGpuVertexFunc} is not concrete.`)) {
      continue;
    }
    // const rawArgVar = functionBlock.mapTempIdentifier(param.identifier, vertexStructType, /* anonymous */ true);
    // params.push({ var: rawArgVar });

    // const mappedArgBopVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
    // let mappedArgVar!: CodeVariable;
    // rewriterFuncs.push(funcWriter => {
    //   mappedArgVar = funcWriter.body.scope.allocateVariableIdentifier(paramType.tempType, BopIdentifierPrefix.Local, param.identifier);
    //   mappedArgBopVar.result = mappedArgVar;
    //   funcWriter.body.writeVariableDeclaration(mappedArgVar);
    // });
    // const paramVar = childCodeScope.allocateVariableIdentifier(paramType.codeTypeSpec ?? this.types.errorType.codeTypeSpec, BopIdentifierPrefix.Local, param.identifier);
    // vertexMarshalCodeTypeSpec = ;

    // const prototypeScope = new BapPrototypeScope();
    // const staticScope = new BapPrototypeScope();
    // const shadowType: BapTypeSpec = {
    //   prototypeScope: prototypeScope,
    //   staticScope: staticScope,
    //   typeParameters: [],
    //   codeTypeSpec: marshalReturnCodeTypeSpec,
    //   isShadow: true,
    //   debugName: paramType.debugName + '_shadow',
    // };
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
    this.asParent(() => {
      let fieldIndex = 0;
      for (const field of resolveBapFields(paramType, context)) {
        const attribs: CodeAttributeDecl[] = [];
        // TODO: MEGA HAXXOR!!!
        if (isGpuFragmentFunc && field.identifier.includes('position')) {
          attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
        } else {
          attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
        }
        const rawField = vertexStructScope.allocateVariableIdentifier(field.type.codeTypeSpec, BopIdentifierPrefix.Field, field.identifier);
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
    });

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
            const vertexVar = childCodeScope.allocateVariableIdentifier(vertexBindings?.marshalCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BopIdentifierPrefix.Local, 'vertex');
            const vertexUserVar = childCodeScope.allocateVariableIdentifier(vertexBindings?.userType.codeTypeSpec ?? this.types.errorType.codeTypeSpec, BopIdentifierPrefix.Local, 'vertex');
            const threadIdVar = childCodeScope.allocateVariableIdentifier(basics.int.codeTypeSpec, BopIdentifierPrefix.Local, 'threadId');
            const fixedVar = childCodeScope.allocateVariableIdentifier(fixedBindings?.bindings.marshalStructCodeTypeSpec ?? this.types.errorType.codeTypeSpec, BopIdentifierPrefix.Local, 'fixed');
            if (vertexBindings) {
              kernelParams.push({ index: vertexParamIndex, typeSpec: vertexVar.typeSpec, codeVar: vertexVar });
              const vertexUserInit = prepare.writeVariableDeclaration(vertexUserVar);
              for (const prop of vertexBindings.rawFieldAccessWriters) {
                const fieldInitExpr = vertexUserInit.initializer.writeAssignStructField(prop.marshalFieldVar.identifierToken).value;
                prop.accessor()?.generateRead(childContext).writeIntoExpression?.(prepare)?.(fieldInitExpr);
              }
            }
            kernelParams.push({ index: threadIdParamIndex, typeSpec: threadIdVar.typeSpec, codeVar: threadIdVar });
            if (fixedBindings) {
              kernelParams.push({ index: optionsParamIndex, typeSpec: fixedVar.typeSpec, codeVar: fixedVar });

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
              kernelFunc.addParam(kernelParam.typeSpec, kernelParam.codeVar.identifierToken);
            }


            const returnVarWriter = returnVarGen?.generateRead(childContext);
            const callWriter = body?.generateRead(childContext);

            returnVarWriter?.writeIntoExpression?.(prepare);

            const innerBlock = prepare.writeWhileLoop();
            innerBlock.condition.writeLiteralBool(true);
            const innerPrepare = innerBlock.body;
            callWriter?.writeIntoExpression?.(innerPrepare);
            innerPrepare.writeBreakStatement();

            const marshalReturnVar = childCodeScope.allocateVariableIdentifier(marshalReturnCodeTypeSpec, BopIdentifierPrefix.Local, 'marshalReturn');
            const marshalReturnInit = prepare.writeVariableDeclaration(marshalReturnVar);
            for (const prop of rawFieldAccessWriters) {
              const fieldInitExpr = marshalReturnInit.initializer.writeAssignStructField(prop.marshalFieldVar.identifierToken).value;
              prop.accessor(returnValueGen)?.generateRead(childContext).writeIntoExpression?.(prepare)?.(fieldInitExpr);
            }
            prepare.writeReturnStatement().expr.writeVariableReference(marshalReturnVar);
            return {
              token: kernelIdentifier,
              bindings: optionsGpuBindings ?? { bindings: [] },
            };
          },
        };
        context.scope.declare(functionName, funcLiteral);
        return funcLiteral;
      },
    };
    return result;
  }
}












// export function bopRewriteShaderFunction(this: BopProcessor, data: {
//   funcName: string;
//   userReturnType: BopType;
//   parameterSignatures: Array<{ identifier: string, type: ts.Type, isAutoField: boolean }>;
//   functionBlock: BopBlock;
// }) {
//   const { funcName, userReturnType, parameterSignatures, functionBlock } = data;
//   const paramDecls: BopFields = [];
//   const params: { var: BopVariable, attribs?: CodeAttributeDecl[] }[] = [];
//   // TODO: HAXXORZZZ !!!!!
//   const isGpuComputeFunc = funcName.includes('computeShader');
//   const isGpuVertexFunc = funcName.includes('vertexShader');
//   const isGpuFragmentFunc = funcName.includes('fragmentShader');
//   const isGpuBoundFunc = isGpuComputeFunc || isGpuFragmentFunc || isGpuVertexFunc;
//   if (!isGpuBoundFunc) {
//     return false;
//   }
//   const stage = isGpuComputeFunc ? 'Compute' : isGpuVertexFunc ? 'Vertex' : 'Fragment';

//   const rewriterFuncs: FuncMutatorFunc[] = [];
//   rewriterFuncs.push(funcWriter => {
//     if (isGpuComputeFunc) {
//       funcWriter.addAttribute({ key: CodeAttributeKey.GpuFunctionCompute });
//       funcWriter.addAttribute({ key: CodeAttributeKey.GpuWorkgroupSize, intValue: 64 });
//     }
//     if (isGpuVertexFunc) {
//       funcWriter.addAttribute({ key: CodeAttributeKey.GpuFunctionVertex });
//     }
//     if (isGpuFragmentFunc) {
//       funcWriter.addAttribute({ key: CodeAttributeKey.GpuFunctionFragment });
//       funcWriter.addReturnAttribute({ key: CodeAttributeKey.GpuBindLocation, intValue: 0 });
//     }
//   });

//   const needsReturnValue = !isGpuComputeFunc;
//   const hasCustomReturnType = !!userReturnType.structOf?.fields;
//   const hasReturnValue = userReturnType?.internalTypeOf || hasCustomReturnType;
//   let returnType;
//   if (needsReturnValue && !hasReturnValue) {
//     this.logAssert(`${isGpuVertexFunc} output is not concrete.`);
//   } else if (hasCustomReturnType && !isGpuFragmentFunc) {
//     const vertexOutStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_${stage}Out`);
//     const vertexOutStructWriter = this.writer.global.writeStruct(vertexOutStructIdentifier);
//     const vertexOutStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
//     const vertexOutStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
//     vertexOutStructWriter.touchedByGpu = true;
//     const vertexOutStructFields: BopVariable[] = [];

//     let fieldIndex = 0;
//     for (const field of userReturnType.structOf!.fields) {
//       const attribs: CodeAttributeDecl[] = [];
//       // TODO: MEGA HAXXOR!!!
//       if (isGpuVertexFunc && field.nameHint.includes('position')) {
//         attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
//       } else {
//         attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
//       }
//       const rawBopVar = vertexOutStructBlock.mapIdentifier(field.nameHint, field.type, field.bopType);
//       const rawField = vertexOutStructScope.allocateVariableIdentifier(field.type, BopIdentifierPrefix.Field, field.nameHint);
//       rawBopVar.result = rawField;
//       vertexOutStructWriter.body.writeField(rawField.identifierToken, field.type, { attribs: attribs });
//       vertexOutStructFields.push(rawBopVar);
//       fieldIndex++;
//     }

//     // Grrr... WebGPU disallows empty structs.
//     if (vertexOutStructWriter.body.fieldCount === 0) {
//       vertexOutStructWriter.body.writeField(vertexOutStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
//     }

//     const vertexOutStructType = BopType.createPassByValue({
//       debugName: `${funcName}_${isGpuVertexFunc}Out`,
//       valueType: CodeTypeSpec.fromStruct(vertexOutStructIdentifier),
//       innerScope: vertexOutStructScope,
//       innerBlock: vertexOutStructBlock,
//       structOf: new BopStructType(vertexOutStructFields),
//     });

//     returnType = vertexOutStructType;
//   }

//   const vertexStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_${stage}In`);
//   const vertexStructWriter = this.writer.global.writeStruct(vertexStructIdentifier);
//   const vertexStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
//   const vertexStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
//   vertexStructWriter.touchedByGpu = true;
//   const vertexStructType = BopType.createPassByValue({
//     debugName: `${funcName}_${isGpuVertexFunc}`,
//     valueType: CodeTypeSpec.fromStruct(vertexStructIdentifier),
//     innerScope: vertexStructScope,
//     innerBlock: vertexStructBlock,
//   });



//   const vertexParamIndex = isGpuComputeFunc ? -1 : 0;
//   const threadIdParamIndex = isGpuComputeFunc ? 0 : 1;
//   const optionsParamIndex = isGpuComputeFunc ? 1 : 2;
//   const bindingLocation = isGpuVertexFunc ? CodeAttributeKey.GpuVertexBindingLocation : isGpuFragmentFunc ? CodeAttributeKey.GpuFragmentBindingLocation : CodeAttributeKey.GpuComputeBindingLocation;

//   let paramIndex = 0;
//   let optionsGpuBindings: GpuBindings|undefined;
//   for (const param of parameterSignatures) {
//     const paramType = this.resolveType(param.type, { inBlock: functionBlock });
//     paramDecls.push({ type: paramType, identifier: param.identifier });

//     if (paramIndex === vertexParamIndex) {
//       if (!this.verifyNotNulllike(paramType.structOf?.fields, `${isGpuVertexFunc} is not concrete.`)) {
//         continue;
//       }

//       const rawArgVar = functionBlock.mapTempIdentifier(param.identifier, vertexStructType, /* anonymous */ true);
//       params.push({ var: rawArgVar });

//       const mappedArgBopVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
//       let mappedArgVar!: CodeVariable;
//       rewriterFuncs.push(funcWriter => {
//         mappedArgVar = funcWriter.body.scope.allocateVariableIdentifier(paramType.tempType, BopIdentifierPrefix.Local, param.identifier);
//         mappedArgBopVar.result = mappedArgVar;
//         funcWriter.body.writeVariableDeclaration(mappedArgVar);
//       });

//       let fieldIndex = 0;
//       for (const field of paramType.structOf!.fields) {
//         const attribs: CodeAttributeDecl[] = [];
//         // TODO: MEGA HAXXOR!!!
//         if (isGpuFragmentFunc && field.nameHint.includes('position')) {
//           attribs.push({ key: CodeAttributeKey.GpuVertexAttributePosition });
//         } else {
//           attribs.push({ key: CodeAttributeKey.GpuBindLocation, intValue: fieldIndex });
//         }
//         const rawField = vertexStructScope.allocateIdentifier(BopIdentifierPrefix.Field, field.nameHint);
//         vertexStructWriter.body.writeField(rawField, field.type, { attribs: attribs });
//         rewriterFuncs.push(funcWriter => {
//           const copyAssign = funcWriter.body.writeAssignmentStatement();
//           copyAssign.ref.writePropertyAccess(field.result!.identifierToken).source.writeVariableReference(mappedArgVar);
//           copyAssign.value.writePropertyAccess(rawField).source.writeVariableReference(rawArgVar.result!);
//         });
//         fieldIndex++;
//       }
//     } else if (paramIndex === threadIdParamIndex) {
//       // TODO: Fix uint.
//       // const argVar = functionBlock.mapTempIdentifier(param.identifier, this.uintType);
//       // params.push({ var: argVar, attribs: [ { key: CodeAttributeKey.GpuBindVertexIndex } ] });
//     } else if (paramIndex === optionsParamIndex) {
//       const optionsBopType = this.resolveType(param.type, { inBlock: functionBlock });
//       if (optionsBopType.structOf) {
//         // HACK!
//         optionsBopType.structOf.touchedByGpu = false;
//       }
//       optionsGpuBindings = makeGpuBindings.bind(this)(optionsBopType);
//       const argVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
//       argVar.requiresDirectAccess = true;
//       for (const binding of optionsGpuBindings.bindings) {
//         if (binding.type === 'fixed') {
//           const marshalParamType = binding.marshalStructType;
//           const uniformVar = this.writer.global.scope.allocateVariableIdentifier(marshalParamType.storageType, BopIdentifierPrefix.Local, param.identifier);
//           rewriterFuncs.push((funcWriter) => {
//             // argVar.result = funcWriter.body.scope.allocateVariableIdentifier(CodeTypeSpec.boolType, 'asdf', 'asdf');
//             binding.unmarshal(uniformVar, funcWriter.body, argVar);
//           });

//           const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
//           varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
//           varWriter.attribs.push({ key: CodeAttributeKey.GpuVarUniform });

//           rewriterFuncs.push((funcWriter) => {
//             const placeholderAssign = funcWriter.body.writeAssignmentStatement();
//             placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
//             placeholderAssign.value.writeIdentifier(uniformVar.identifierToken);
//           });
//         } else if (binding.type === 'array') {
//           const userElementType = binding.userType;
//           const userParamType = userElementType.storageType.toArray();
//           const uniformVar = this.writer.global.scope.allocateVariableIdentifier(userParamType, BopIdentifierPrefix.Local, `${param.identifier}_${binding.nameHint}`);
//           rewriterFuncs.push((funcWriter) => {
//             binding.unmarshal(uniformVar, funcWriter.body, argVar);
//           });

//           const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
//           varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
//           varWriter.attribs.push({ key: CodeAttributeKey.GpuVarReadWriteArray });

//           rewriterFuncs.push((funcWriter) => {
//             const placeholderAssign = funcWriter.body.writeAssignmentStatement();
//             placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
//             placeholderAssign.value.writeVariableReferenceReference(uniformVar.identifierToken);
//           });
//         } else if (binding.type === 'texture') {
//           const userParamType = this.libTypes.Texture.tempType;
//           const uniformVar = this.writer.global.scope.allocateVariableIdentifier(userParamType, BopIdentifierPrefix.Local, `${param.identifier}_${binding.nameHint}`);
//           rewriterFuncs.push((funcWriter) => {
//             binding.unmarshal(uniformVar, funcWriter.body, argVar);
//           });

//           const varWriter = this.writer.global.writeVariableDeclaration(uniformVar);
//           varWriter.attribs.push({ key: bindingLocation, intValue: binding.location });
//           // varWriter.attribs.push({ key: CodeAttributeKey.GpuVarReadWriteArray });

//           rewriterFuncs.push((funcWriter) => {
//             const placeholderAssign = funcWriter.body.writeAssignmentStatement();
//             placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
//             placeholderAssign.value.writeVariableReference(uniformVar.identifierToken);
//           });
//         }
//       }
//       rewriterFuncs.push((funcWriter) => {
//         const placeholderAssign = funcWriter.body.writeAssignmentStatement();
//         placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
//         placeholderAssign.value.writeVariableReferenceReference(this.writer.makeInternalToken('BopLib_DebugIns_ValuesArray'));
//       });
//       rewriterFuncs.push((funcWriter) => {
//         const placeholderAssign = funcWriter.body.writeAssignmentStatement();
//         placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
//         placeholderAssign.value.writeVariableReferenceReference(this.writer.makeInternalToken('BopLib_DebugOuts_Metadata'));
//       });
//       // GRRR webgpu
//       if (!isGpuVertexFunc) {
//         rewriterFuncs.push((funcWriter) => {
//           const placeholderAssign = funcWriter.body.writeAssignmentStatement();
//           placeholderAssign.ref.writeIdentifier(this.underscoreIdentifier);
//           placeholderAssign.value.writeVariableReferenceReference(this.writer.makeInternalToken('BopLib_DebugOuts_ValuesArray'));
//         });
//       }
//     }
//     paramIndex++;
//   }
//   const paramRewriter: FuncMutatorFunc = (funcWriter) => {
//     for (const rewriter of rewriterFuncs) {
//       rewriter(funcWriter);
//     }
//   };

//   // Grrr... WebGPU disallows empty structs.
//   if (vertexStructWriter.body.fieldCount === 0) {
//     vertexStructWriter.body.writeField(vertexStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
//   }
//   // if (insStructWriter.body.fieldCount === 0) {
//   //   insStructWriter.body.writeField(insStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
//   // }

//   return { returnType, paramRewriter, paramDecls, params, gpuBindings: optionsGpuBindings };
// }

