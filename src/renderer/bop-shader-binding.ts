import * as ts from "typescript";
import { CodeScopeType, CodeTypeSpec, CodeVariable } from './code-writer';
import { BopType } from './bop-type';
import { getNodeLabel } from './ts-helpers';
import { BopStage, BopIdentifierPrefix } from './bop-data';
import { BopProcessor } from './bop-processor';

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
  const renderElementsArgBops = renderElementsCallNode.arguments.map(arg => this.visitChild(arg));
  if (renderElementsArgBops.length !== 3) {
    this.logAssert(`Call to Gpu.renderElements takes 3 arguments (${renderElementsArgBops.length} provided).`);
    return;
  }
  const primitiveCountBop = renderElementsArgBops[0];
  const vertexFunctionBop = renderElementsArgBops[1];
  const fragmentFunctionBop = renderElementsArgBops[2];

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
      this.instanceBlockWriter.writeField(pipelineInstanceVar.identifierToken, this.privateTypes.MTLRenderPipelineDescriptor.storageType);
      const renderPassDescriptorInstanceVar = this.instanceScope.allocateVariableIdentifier(this.privateTypes.MTLRenderPassDescriptor.storageType, BopIdentifierPrefix.Field, `${pipelineName}_renderPassDescriptor`);
      this.instanceBlockWriter.writeField(renderPassDescriptorInstanceVar.identifierToken, this.privateTypes.MTLRenderPassDescriptor.storageType);

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
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLPixelFormatBGRA8Unorm_sRGB'));
        }
        // pipelineStateDescriptor.colorAttachments[0].blendingEnabled = true;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('blendingEnabled'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeLiteralBool(true);
        }
        // pipelineStateDescriptor.colorAttachments[0].alphaBlendOperation = MTLBlendOperationAdd;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('alphaBlendOperation'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendOperationAdd'));
        }
        // pipelineStateDescriptor.colorAttachments[0].rgbBlendOperation = MTLBlendOperationAdd;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('rgbBlendOperation'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendOperationAdd'));
        }
        // pipelineStateDescriptor.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOne;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('destinationAlphaBlendFactor'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorOne'));
        }
        // pipelineStateDescriptor.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOne;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('destinationRGBBlendFactor'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorOne'));
        }
        // pipelineStateDescriptor.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('sourceAlphaBlendFactor'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorOne'));
        }
        // pipelineStateDescriptor.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('sourceRGBBlendFactor'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(pipelineStateDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLBlendFactorSourceAlpha'));
        }
        // drawTriangle1_pipeline1 = [device newRenderPipelineStateWithDescriptor:pipelineStateDescriptor error:&error];
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writeVariableReference(pipelineInstanceVar);
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
              .source.writeIndexAccess(0)
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
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(renderPassDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLLoadActionClear'));
        }
        // renderPassDescriptor.colorAttachments[0].storeAction = MTLStoreActionStore;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('storeAction'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(renderPassDescriptorVar);
          assign.value.writeIdentifier(this.writer.makeInternalToken('MTLStoreActionStore'));
        }
        // drawTriangle1_renderPassDescriptor1 = renderPassDescriptor;
        {
          const assign = blockWriter.writeAssignmentStatement();
          assign.ref.writeVariableReference(renderPassDescriptorInstanceVar);
          assign.value.writeVariableReference(renderPassDescriptorVar);
        }
      }


      {
        // auto positions = generateTriangleVertices(10);
        const allocTmpOut = (bopType: BopType): CodeVariable => {
          const outBopVar = this.block.mapIdentifier('tmp', bopType.tempType, bopType, /* anonymous */ true);
          const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, getNodeLabel(node));
          outBopVar.result = outVar;
          return outVar;
        };

        const positionsVar = allocTmpOut(this.functionType);

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
        const renderPassDescriptorInit = renderPassDescriptor.initializer.writeExpression().writeVariableReference(renderPassDescriptorInstanceVar);
        // renderPassDescriptor.colorAttachments[0].texture = renderTarget;
        {
          const assign = this.blockWriter.writeAssignmentStatement();
          assign.ref
              .writePropertyAccess(this.writer.makeInternalToken('texture'))
              .source.writeIndexAccess(0)
              .source.writePropertyAccess(this.writer.makeInternalToken('colorAttachments'))
              .source.writeVariableReference(renderPassDescriptorVar);
          assign.value.writeVariableReference(renderTargetVar);
        }
        // id<MTLRenderCommandEncoder> encoder = [GetCurrentCommandBuffer() renderCommandEncoderWithDescriptor:renderPassDescriptor];
        const encoderVar = allocTmpOut(this.privateTypes.MTLRenderCommandEncoder);
        const encoder = this.blockWriter.writeVariableDeclaration(encoderVar);
        const encoderInit = encoder.initializer.writeExpression().writeStaticFunctionCall(this.writer.makeInternalToken('MakeRenderCommandEncoder'));
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
          assign.value.writeVariableReference(pipelineInstanceVar);
        }

        // [encoder setVertexBytes:&vertexMetadata length:sizeof(vertexMetadata) atIndex:0];
        // [encoder setVertexBuffer:position.GpuBuffer() offset:0 atIndex:1];
        {
          const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken('EncoderSetVertexBuffer'));
          call.addArg().writeVariableReference(encoderVar);
          call.addArg().writeMethodCall(this.writer.makeInternalToken('GpuBuffer')).source.writeVariableReference(positionsVar);
          call.addArg().writeLiteralInt(0);
          call.addArg().writeLiteralInt(1);
        }
        // [encoder setVertexBytes:&vertexOptions length:sizeof(vertexOptions) atIndex:2];
        // [encoder setFragmentBytes:&fragmentMetadata length:sizeof(fragmentMetadata) atIndex:0];
        // [encoder setFragmentBytes:&fragmentOptions length:sizeof(fragmentOptions) atIndex:1];

        // [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:(uint)(positions.GetCount())];
        {
          const call = this.blockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(this.writer.makeInternalToken('EncoderDrawPrimitives'));
          call.addArg().writeVariableReference(encoderVar);
          call.addArg().writeIdentifier(this.writer.makeInternalToken('MTLPrimitiveTypeTriangle'));
          call.addArg().writeLiteralInt(0);
          const getCountCall = call.addArg().writeMethodCall(this.writer.makeInternalToken('GetCount'));
          getCountCall.source.writeVariableReference(positionsVar);
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