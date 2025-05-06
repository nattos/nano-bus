import ts from 'typescript/lib/typescript';
import { BapSubtreeGenerator, BapTypeSpec } from '../bap-value';
import { BapVisitor } from '../bap-visitor';
import { BopIdentifierPrefix } from '../bop-data';
import { CodeTypeSpec, CodeScopeType, CodeVariable } from '../code-writer';
import { getNodeLabel } from '../ts-helpers';
import { BufferFiller } from './buffer-filler';
import { GpuBindings } from './gpu-bindings';


/**
 * Determines if the call expression is a special function, and rewrite the call
 * appropriately to run work on the GPU.
 *
 * These correspond to calls like `Gpu.renderElements`, which invokes vertex
 * and fragment shaders on geometry to produce color values.
 */
export function bopShaderBinding(this: BapVisitor, node: ts.CallExpression): BapSubtreeGenerator | undefined {
  // Hacky special cases!!! These are necessary for now since specialized
  // generics handling, like vararg expansions are not supported.
  const isRenderElements = ts.isCallExpression(node.expression) &&
    ts.isCallExpression(node.expression.expression) &&
    ts.isPropertyAccessExpression(node.expression.expression.expression) &&
    ts.isIdentifier(node.expression.expression.expression.expression) &&
    this.tc.getTypeAtLocation(node.expression.expression.expression.expression)?.symbol?.name === 'GpuStatic' &&
    node.expression.expression.expression.name.text === 'renderElements';
  if (isRenderElements) {
    return bopRenderElementsCall.bind(this)(node, node.expression, node.expression.expression);
  }
}

function bopRenderElementsCall(
  this: BapVisitor,
  fragmentCallNode: ts.CallExpression,
  vertexCallNode: ts.CallExpression,
  renderElementsCallNode: ts.CallExpression
): BapSubtreeGenerator | undefined {
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
  const vertexArgBops = vertexCallNode.arguments.map(arg => this.child(arg));

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
            const bindBindings = (bindings: GpuBindings, dataVar: CodeVariable, stage: 'Vertex' | 'Fragment') => {
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
                  const { arrayVar } = binding.marshal(dataVar, blockWriter);
                  const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken(`EncoderSet${stage}Buffer`));
                  call.addArg().writeVariableReference(encoderVar);
                  call.addArg().writeVariableReference(arrayVar);
                  call.addArg().writeLiteralInt(0);
                  call.addArg().writeLiteralInt(binding.location);
                }
              }
            };

            const vertexOptionsVar = allocTmpOut((vertexOptionsValue?.typeSpec)!);
            const vertexOptionsVarDecl = blockWriter.writeVariableDeclaration(vertexOptionsVar);
            const fragmentOptionsVar = allocTmpOut((fragmentOptionsValue?.typeSpec)!);
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
