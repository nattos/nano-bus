import ts from 'typescript/lib/typescript';
import { BapSubtreeGenerator, BapTypeSpec } from '../bap-value';
import { BapVisitor } from '../bap-visitor';
import { BapIdentifierPrefix } from '../bap-constants';
import { CodeTypeSpec, CodeScopeType, CodeVariable } from '../code-writer/code-writer';
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
  const isCompute =
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      this.tc.getTypeAtLocation(node.expression.expression.expression)?.symbol?.name === 'GpuStatic' &&
      node.expression.expression.name.text === 'compute';
  if (isCompute) {
    return bopComputeCall.bind(this)(node, node.expression);
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

  // console.log(this.tc.signatureToString(renderElementsFunctionSignature));
  // console.log(this.tc.signatureToString(vertexFunctionSignature));
  // console.log(this.tc.signatureToString(fragmentFunctionSignature));

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

  const generateRead: BapSubtreeGenerator['generateRead'] = (context) => {
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

        const pipelineName = `${vertexFunctionValue.debugName ?? 'vertex'}_${fragmentFunctionValue.debugName ?? 'fragment'}`;
        const basics = this.types.basic(context);
        const instanceScope = context.instanceVars.scope;
        const instanceBlockWriter = context.instanceVars.blockWriter;
        const instanceVarsIdentifier = context.instanceVars.codeVar.identifierToken;

        const pipelineInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLRenderPipelineDescriptor.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_pipeline`);
        instanceBlockWriter.body.writeField(pipelineInstanceVar.identifierToken, basics.MTLRenderPipelineDescriptor.codeTypeSpec);
        const renderPassDescriptorInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLRenderPassDescriptor.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_renderPassDescriptor`);
        instanceBlockWriter.body.writeField(renderPassDescriptorInstanceVar.identifierToken, basics.MTLRenderPassDescriptor.codeTypeSpec);

        const vertexFunctionInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLFunction.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_vertexShader`);
        instanceBlockWriter.body.writeField(vertexFunctionInstanceVar.identifierToken, basics.MTLFunction.codeTypeSpec);
        const fragmentFunctionInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLFunction.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_fragmentShader`);
        instanceBlockWriter.body.writeField(fragmentFunctionInstanceVar.identifierToken, basics.MTLFunction.codeTypeSpec);

        const vertexFuncIdentifier = vertexKernel.token;
        const fragmentFuncIdentifier = fragmentKernel.token;
        // Emit pipeline setup code, and store the pipeline in globals.
        const writer = context.globalWriter;
        {
          const initFuncIdentifier = writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BapIdentifierPrefix.Function, `${pipelineName}_prepare`);
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

          for (const binding of vertexKernel.bindings.bindings.concat(fragmentKernel.bindings.bindings)) {
            binding.writeIntoInitFunc?.(blockWriter);
          }
        }

        const blockWriter = prepare;
        {
          const allocTmpOut = (type: BapTypeSpec): CodeVariable => {
            const outVar = blockWriter.scope.createVariableInScope(type.codeTypeSpec, getNodeLabel(renderElementsCallNode));
            return outVar;
          };

          const renderTargetVar = allocTmpOut(basics.Texture);
          const renderTarget = blockWriter.writeVariableDeclaration(renderTargetVar);
          const renderTargetInit = renderTarget.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('AllocatePersistentTexture'));
          renderTargetInit.addArg().writeStaticFunctionCall(writer.makeInternalToken('GetTrackTextureFormat'));
          renderTargetInit.addArg().writeLiteralInt(12345678);

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
                var bufferFillerVar = blockWriter.scope.allocateVariableIdentifier(basics.BufferFiller.codeTypeSpec, BapIdentifierPrefix.Local, 'bufferFiller');
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
              } else if (binding.type === 'texture') {
                const { textureVar, samplerVar } = binding.marshal(dataVar, blockWriter);
                const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken(`EncoderSet${stage}Texture`));
                call.addArg().writeVariableReference(encoderVar);
                call.addArg().writeVariableReference(textureVar);
                call.addArg().writeVariableReference(samplerVar);
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
          return (expr) => {
            expr.writeVariableReference(renderTargetVar);
          };
        }
      },
    };
  };
  return {
    generateRead,
  };
}

function bopComputeCall(
  this: BapVisitor,
  fragmentCallNode: ts.CallExpression,
  renderElementsCallNode: ts.CallExpression
): BapSubtreeGenerator | undefined {
  // const fragmentCallNode = node;
  // const vertexCallNode = node.expression;
  // const renderElementsCallNode = node.expression.expression;
  const fragmentFunctionSignature = this.tc.getResolvedSignature(fragmentCallNode, [], fragmentCallNode.arguments.length);
  const renderElementsFunctionSignature = this.tc.getResolvedSignature(renderElementsCallNode, [], renderElementsCallNode.arguments.length);
  if (!this.verifyNotNulllike(renderElementsFunctionSignature, `Gpu.renderElements function has unresolved signature.`) ||
    !this.verifyNotNulllike(fragmentFunctionSignature, `Compute kernel has unresolved signature.`)) {
    return;
  }

  // console.log(this.tc.signatureToString(renderElementsFunctionSignature));
  // console.log(this.tc.signatureToString(fragmentFunctionSignature));

  const fragmentArgBops = fragmentCallNode.arguments.map(arg => this.child(arg));

  const renderElementsArgs = renderElementsCallNode.arguments;
  if (renderElementsArgs.length !== 2) {
    this.logAssert(`Call to Gpu.compute takes 2 arguments (${renderElementsArgs.length} provided).`);
    return;
  }

  const primitiveCountBop = this.child(renderElementsArgs[0]);
  // Prevent temporaries from getting created. We only need the names, not
  // references, since these will be GPU only.
  const fragmentFunctionBop = this.child(renderElementsArgs[1]);

  const generateRead: BapSubtreeGenerator['generateRead'] = (context) => {
    const fragmentFunctionValue = fragmentFunctionBop?.generateRead(context);
    const primitiveCountValue = primitiveCountBop?.generateRead(context);
    const fragmentOptionsValue = fragmentArgBops[0]?.generateRead(context);

    return {
      type: 'cached',
      writeIntoExpression: (prepare) => {
        if (fragmentFunctionValue?.type !== 'function') {
          this.logAssert(`Compute kernel is not a function.`);
          return;
        }
        const fragmentKernel = fragmentFunctionValue.generateGpuKernel?.();
        if (!this.verifyNotNulllike(fragmentKernel, () => `Cannot use function as compute kernel.`)) {
          return;
        }

        const primitiveCountWriter = primitiveCountValue?.writeIntoExpression?.(prepare);
        const fragmentOptionsWriter = fragmentOptionsValue?.writeIntoExpression?.(prepare);

        const pipelineName = `${fragmentFunctionValue.debugName ?? 'compute'}`;
        const basics = this.types.basic(context);
        const instanceScope = context.instanceVars.scope;
        const instanceBlockWriter = context.instanceVars.blockWriter;
        const instanceVarsIdentifier = context.instanceVars.codeVar.identifierToken;

        const pipelineInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLRenderPipelineDescriptor.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_pipeline`);
        instanceBlockWriter.body.writeField(pipelineInstanceVar.identifierToken, basics.MTLRenderPipelineDescriptor.codeTypeSpec);
        const renderPassDescriptorInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLRenderPassDescriptor.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_renderPassDescriptor`);
        instanceBlockWriter.body.writeField(renderPassDescriptorInstanceVar.identifierToken, basics.MTLRenderPassDescriptor.codeTypeSpec);

        const vertexFunctionInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLFunction.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_vertexShader`);
        instanceBlockWriter.body.writeField(vertexFunctionInstanceVar.identifierToken, basics.MTLFunction.codeTypeSpec);
        const fragmentFunctionInstanceVar = instanceScope.allocateVariableIdentifier(basics.MTLFunction.codeTypeSpec, BapIdentifierPrefix.Field, `${pipelineName}_fragmentShader`);
        instanceBlockWriter.body.writeField(fragmentFunctionInstanceVar.identifierToken, basics.MTLFunction.codeTypeSpec);

        const fragmentFuncIdentifier = fragmentKernel.token;
        // Emit pipeline setup code, and store the pipeline in globals.
        const writer = context.globalWriter;
        {
          const initFuncIdentifier = writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BapIdentifierPrefix.Function, `${pipelineName}_prepare`);
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

          // id<MTLFunction> fragmentFunction = [defaultLibrary newFunctionWithName:@"drawTriangle1_fragmentShader"];
          const fragmentFunctionVar = allocTmpOut(basics.MTLFunction);
          const fragmentFunction = blockWriter.writeVariableDeclaration(fragmentFunctionVar);
          const fragmentFunctionInit = fragmentFunction.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MTLLibraryNewFunctionWithName'));
          fragmentFunctionInit.addArg().writeLiteralStringToken(fragmentFuncIdentifier, { managed: true });

          {
            const assign = blockWriter.writeAssignmentStatement();
            assign.ref.writePropertyAccess(fragmentFunctionInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
            assign.value.writeVariableReference(fragmentFunctionVar);
          }

          // MTLRenderPipelineDescriptor* pipelineStateDescriptor = [[MTLRenderPipelineDescriptor alloc] init];
          const pipelineStateDescriptorVar = allocTmpOut(basics.MTLComputePipelineDescriptor);
          const pipelineStateDescriptor = blockWriter.writeVariableDeclaration(pipelineStateDescriptorVar);
          const pipelineStateDescriptorInit = pipelineStateDescriptor.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MakeMTLComputePipelineDescriptor'));

          // pipelineStateDescriptor.label = @"RenderPrimitives";
          {
            const assign = blockWriter.writeAssignmentStatement();
            assign.ref.writePropertyAccess(writer.makeInternalToken('label')).source.writeVariableReference(pipelineStateDescriptorVar);
            assign.value.writeLiteralString(pipelineName, { managed: true });
          }
          // pipelineStateDescriptor.fragmentFunction = fragmentFunction;
          {
            const assign = blockWriter.writeAssignmentStatement();
            assign.ref.writePropertyAccess(writer.makeInternalToken('computeFunction')).source.writeVariableReference(pipelineStateDescriptorVar);
            assign.value.writeVariableReference(fragmentFunctionVar);
          }
          // drawTriangle1_pipeline1 = [device newRenderPipelineStateWithDescriptor:pipelineStateDescriptor error:&error];
          {
            const assign = blockWriter.writeAssignmentStatement();
            assign.ref.writePropertyAccess(pipelineInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
            const call = assign.value.writeStaticFunctionCall(writer.makeInternalToken('MTLNewComputePipelineStateWithDescriptor'));
            call.addArg().writeVariableReference(pipelineStateDescriptorVar);
          }

          for (const binding of fragmentKernel.bindings.bindings) {
            binding.writeIntoInitFunc?.(blockWriter);
          }
        }

        const blockWriter = prepare;
        {
          const allocTmpOut = (type: BapTypeSpec): CodeVariable => {
            const outVar = blockWriter.scope.createVariableInScope(type.codeTypeSpec, getNodeLabel(renderElementsCallNode));
            return outVar;
          };

          // id<MTLRenderCommandEncoder> encoder = [GetCurrentCommandBuffer() renderCommandEncoderWithDescriptor:renderPassDescriptor];
          const encoderVar = allocTmpOut(basics.MTLComputeCommandEncoder);
          const encoder = blockWriter.writeVariableDeclaration(encoderVar);
          const encoderInit = encoder.initializer.writeExpression().writeStaticFunctionCall(writer.makeInternalToken('MakeMTLComputeCommandEncoder'));
          // encoder.label = @"RenderPrimitives";
          {
            const assign = blockWriter.writeAssignmentStatement();
            assign.ref.writePropertyAccess(writer.makeInternalToken('label')).source.writeVariableReference(encoderVar);
            assign.value.writeLiteralString('RenderPrimitives', { managed: true });
          }
          // [encoder setRenderPipelineState:drawTriangle1_pipeline1];
          {
            const assign = blockWriter.writeAssignmentStatement();
            assign.ref.writePropertyAccess(writer.makeInternalToken('pipelineState')).source.writeVariableReference(encoderVar);
            assign.value.writePropertyAccess(pipelineInstanceVar.identifierToken).source.writeVariableReference(instanceVarsIdentifier);
          }

          // [encoder setVertexBytes:&vertexOptions length:sizeof(vertexOptions) atIndex:2];
          const bindBindings = (bindings: GpuBindings, dataVar: CodeVariable, stage: 'Vertex' | 'Fragment' | 'Compute') => {
            if (!this.verifyNotNulllike(bindings, `Expected GPU bindings for ${stage} function, but none were found.`)) {
              return;
            }
            for (const binding of bindings.bindings) {
              if (binding.type === 'fixed') {
                var bufferFillerVar = blockWriter.scope.allocateVariableIdentifier(basics.BufferFiller.codeTypeSpec, BapIdentifierPrefix.Local, 'bufferFiller');
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
              } else if (binding.type === 'texture') {
                const { textureVar, samplerVar } = binding.marshal(dataVar, blockWriter);
                const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken(`EncoderSet${stage}Texture`));
                call.addArg().writeVariableReference(encoderVar);
                call.addArg().writeVariableReference(textureVar);
                call.addArg().writeVariableReference(samplerVar);
                call.addArg().writeLiteralInt(binding.location);
              }
            }
          };

          const fragmentOptionsVar = allocTmpOut((fragmentOptionsValue?.typeSpec)!);
          const fragmentOptionsVarDecl = blockWriter.writeVariableDeclaration(fragmentOptionsVar);
          fragmentOptionsWriter?.(fragmentOptionsVarDecl.initializer.writeExpression());
          bindBindings(fragmentKernel.bindings, fragmentOptionsVar, 'Compute');
          {
            const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken('EncoderDispatchWorkgroups'));
            call.addArg().writeVariableReference(encoderVar);
            primitiveCountWriter?.(call.addArg());
          }
          // [encoder endEncoding];
          {
            const call = blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(writer.makeInternalToken('EncoderEndEncoding'));
            call.addArg().writeVariableReference(encoderVar);
          }
        }
        return undefined;
      },
    };
  };
  return {
    generateRead,
  };
}
