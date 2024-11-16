import * as utils from '../utils';
import * as ts from "typescript";
import { CodeAttributeDecl, CodeAttributeKey, CodeBinaryOperator, CodeExpressionWriter, CodeFunctionWriter, CodeNamedToken, CodePrimitiveType, CodeScope, CodeScopeType, CodeStatementWriter, CodeStructBodyWriter, CodeStructWriter, CodeTypeSpec, CodeUnaryOperator, CodeVariable, CodeWriter, CodeWriterPlatform } from './code-writer';
import { BopType, BopFunctionConcreteImplDetail, BopInternalTypeBuilder, BopFields, BopFunctionType, BopTypeUnion, BopStructType, BopInternalType, BopFunctionOf } from './bop-type';
import { getNodeLabel, tsGetMappedType, tsGetSourceFileOfNode, tsGetSyntaxTypeLabel, tsTypeMapper } from './ts-helpers';
import { BopBlock, BopStage, BopResult, BopIdentifierPrefix, BopGenericFunction, BopVariable, BopReference, BopGenericFunctionInstance, BopInferredNumberType, BopAuxTypeInference } from './bop-data';
import { loadBopLib, toStringResolvedType } from './bop-lib-loader';
import { bopRewriteShaderFunction, bopShaderBinding, FuncMutatorFunc, GpuBindings } from './bop-shader-binding';
import { evalJavascriptInContext, SharedMTLInternals } from './bop-javascript-lib';
import { WGSL_LIB_CODE } from './bop-wgsl-lib';




interface CoersionRef {
  assignedFromBop?: BopStage;
}



export class BopProcessor {
  readonly tc: ts.TypeChecker;
  readonly writer = new CodeWriter();
  readonly globalBlock: BopBlock;
  blockWriter: CodeStatementWriter;
  initFuncBlockWriter: CodeStatementWriter;
  block: BopBlock;
  scopeReturnType: BopType;
  asAssignableRef = false;
  private unrolledBlocks?: BopStage[];

  readonly instanceVarsIdentifier: CodeVariable;
  readonly instanceBlockWriter: CodeStructWriter;
  readonly instanceScope: CodeScope;
  readonly prepareFuncs: CodeVariable[] = [];
  readonly bopFunctionConcreteImpls: BopFunctionConcreteImplDetail[] = [];
  private readonly specialHandlers: Array<(node: ts.CallExpression) => BopStage|undefined> = [
    bopShaderBinding.bind(this),
  ];

  readonly underscoreIdentifier: CodeNamedToken;

  readonly errorType;
  readonly wouldBeAnyType;
  readonly typeType;
  readonly functionType;
  readonly voidType;
  readonly booleanType;
  readonly intType;
  readonly floatType;
  readonly float4Type;
  readonly undefinedType;
  readonly undefinedConstant;
  private readonly resultMap = new Map<BopStage, BopResult>();

  readonly privateTypes;

  constructor(
    public readonly program: ts.Program,
    public readonly sourceRoot: ts.SourceFile,
  ) {
    this.tc = program.getTypeChecker();
    sourceRoot.statements.forEach(this.printRec.bind(this));

    const initFunc = this.writer.global.writeFunction(this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Function, 'init'));
    initFunc.touchedByCpu = true;
    this.blockWriter = initFunc.body;
    this.initFuncBlockWriter = initFunc.body;
    this.globalBlock = BopBlock.createGlobalBlock();
    this.block = this.globalBlock;

    this.instanceScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
    const instanceVarsTypeIdentifier = this.writer.makeInternalToken('InstanceVars');
    this.instanceBlockWriter = this.writer.global.writeStruct(instanceVarsTypeIdentifier);
    this.instanceBlockWriter.isInternalOnly = true;
    this.instanceBlockWriter.touchedByGpu = false;
    const instanceVarsToken = this.writer.makeInternalToken('instanceVars');
    this.instanceVarsIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.fromStruct(instanceVarsTypeIdentifier), BopIdentifierPrefix.Local, 'instanceVars', { fixedIdentifierToken: instanceVarsToken });

    // Map intrinsic types.
    this.underscoreIdentifier = this.writer.makeInternalToken('_');
    this.errorType = this.createPrimitiveType(CodeTypeSpec.compileErrorType);
    this.wouldBeAnyType = this.createPrimitiveType(CodeTypeSpec.compileErrorType);
    this.functionType = this.createPrimitiveType(CodeTypeSpec.functionType);
    this.typeType = this.createPrimitiveType(CodeTypeSpec.typeType);
    this.typeMap.set(this.tc.getVoidType(), this.voidType = this.createPrimitiveType(CodeTypeSpec.voidType));
    this.typeMap.set(this.tc.getBooleanType(), this.booleanType = this.createPrimitiveType(CodeTypeSpec.boolType));
    this.undefinedType = this.createInternalType({ identifier: 'UndefinedType', anonymous: true }).type;
    this.undefinedConstant = this.createInternalConstant({ identifier: 'undefined', internalIdentifier: 'kUndefinedValue', type: this.undefinedType });
    this.privateTypes = {
      Texture: this.createInternalType({ identifier: 'Texture', anonymous: true }).type,
      MTLDevice: this.createInternalType({ identifier: 'id<MTLDevice>', anonymous: true }).type,
      MTLFunction: this.createInternalType({ identifier: 'id<MTLFunction>', anonymous: true }).type,
      MTLRenderPipelineDescriptor: this.createInternalType({ identifier: 'MTLRenderPipelineDescriptor*', anonymous: true }).type,
      MTLRenderPassDescriptor: this.createInternalType({ identifier: 'MTLRenderPassDescriptor*', anonymous: true }).type,
      MTLRenderCommandEncoder: this.createInternalType({ identifier: 'id<MTLRenderCommandEncoder>', anonymous: true }).type,
      MTLPrimitiveTypeTriangle: this.createInternalType({ identifier: 'MTLPrimitiveTypeTriangle', anonymous: true }).type,
      MTLComputePipelineDescriptor: this.createInternalType({ identifier: 'MTLComputePipelineDescriptor*', anonymous: true }).type,
      MTLComputePassDescriptor: this.createInternalType({ identifier: 'MTLComputePassDescriptor*', anonymous: true }).type,
      MTLComputeCommandEncoder: this.createInternalType({ identifier: 'id<MTLComputeCommandEncoder>', anonymous: true }).type,
      BufferFiller: this.createInternalType({ identifier: 'BufferFiller', anonymous: true }).type,
    };


    const { libTypes, newBopTypeMap } = loadBopLib(this);

    this.intType = newBopTypeMap.get('int')!.bopType!;
    this.floatType = newBopTypeMap.get('float')!.bopType!;
    this.float4Type = newBopTypeMap.get('float4')!.bopType!;
    // this.typeMap.set(this.tc.getNumberType(), this.intType); // TODO: FIX!!!

    for (const type of libTypes.values()) {
      const typeArgs = type.typeParameters.map(t => utils.upcast({ name: t, typeArgs: [] }));
      const typeName = toStringResolvedType({ name: type.name, typeArgs });
      for (const prop of type.properties) {
        const propType = prop.type(typeArgs);
        // console.log(`${typeName}.${prop.name}: ${toStringResolvedType(propType)}`);
      }
      for (const method of type.methods) {
        const methodTypeArgs = method.typeParameters.map(t => utils.upcast({ name: t, typeArgs: [] }));
        let methodName = method.name;
        if (methodTypeArgs.length > 0) {
          methodName += `<${methodTypeArgs.map(toStringResolvedType).join(', ')}>`;
        }
        // console.log(`${typeName}.${methodName}(${method.parameters.map(p => `${p.name}: ${toStringResolvedType(p.type(typeArgs, methodTypeArgs))}`).join(', ')}): ???`);
      }
    }

    console.log(Array.from(libTypes.values()));






    this.scopeReturnType = this.errorType;

    this.visitTopLevelNode(this.sourceRoot);
    console.log(this.globalBlock);

    this.mapAndResolveRec(this.globalBlock);

    for (const c of this.globalBlock.children) {
      if (c instanceof BopBlock) {
      } else {
        this.doProduceResult(c);
      }
    }

    for (const prepareFunc of this.prepareFuncs) {
      this.initFuncBlockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(prepareFunc.identifierToken);
    }

    utils.visitRec(
        this.bopFunctionConcreteImpls.filter(impl => impl.touchedByCpu),
        node => Array.from(node.references),
        node => node.touchedByCpu = true);
    utils.visitRec(
        this.bopFunctionConcreteImpls.filter(impl => impl.touchedByGpu),
        node => Array.from(node.references),
        node => node.touchedByGpu = true);

    const platform = CodeWriterPlatform.WebGPU;
    const cpuCode = this.writer.getOuterCode(false, platform);
    console.log(cpuCode);
    const gpuCode = this.writer.getOuterCode(true, platform);
    console.log(gpuCode);

    // const evalContext = new BopJavascriptEvalContext();
    // function evalInContext(this: BopJavascriptEvalContext, code: string) {
    //   return eval(code);
    // }
    SharedMTLInternals().loadShaderCode(gpuCode);
    evalJavascriptInContext(`
const instanceVars = {};
` + cpuCode + `
(async () => {
  await WaitForInternalsReady();
  F8_computeShader_prepare();
  F10_vertexShader_fragmentShader_prepare();
  // F8_vertexShader_fragmentShader_prepare();
  // F8_computeShader_prepare();
  F6_drawTriangle();
  // F1_drawTriangle();
})();
`);

    // (async () => {
    //   const adapter = await navigator.gpu.requestAdapter();
    //   const device = await adapter?.requestDevice();
    //   if (!adapter || !device) {
    //     return;
    //   }
    //   const shaderModule = device.createShaderModule({
    //     code: gpuCode + WGSL_LIB_CODE,
    //   });
    //   const compilationInfo = await shaderModule.getCompilationInfo();
    //   if (compilationInfo.messages.length > 0) {
    //     console.log(compilationInfo.messages.map(m => `${m.lineNum}:${m.linePos} ${m.type}: ${m.message}`).join('\n'));
    //   }
    // })();
  }

  private mapAndResolveRec(block: BopBlock, children?: Array<BopStage|BopBlock>) {
    children ??= block.children;
    const visitRec = (block: BopBlock, children: Array<BopStage|BopBlock>, func: (stage: BopStage, block: BopBlock) => void) => {
      for (const c of children) {
        if (c instanceof BopBlock) {
          visitRec(c, c.children, func);
        } else {
          func(c, block);
        }
      }
    };
    const inBlock = (func: (stage: BopStage, block: BopBlock) => void) => {
      return (stage: BopStage, block: BopBlock) => {
        const oldBlock = this.block;
        func(stage, block);
        this.block = oldBlock;
      };
    };

    visitRec(block, children, inBlock(stage => stage.mapIdentifiers?.()));
    visitRec(block, children, inBlock(stage => {
      if (!stage.resolvedIdentifiers) {
        stage.resolvedIdentifiers = true;
        stage.resolveIdentifiers?.();
      }
    }));
  }

  private createPrimitiveType(type: CodeTypeSpec): BopType {
    return BopType.createPassByValue({
        debugName: type.asPrimitive ?? '???',
        valueType: type,
        innerScope: this.writer.global.scope.createChildScope(CodeScopeType.Class),
        innerBlock: this.globalBlock.createChildBlock(CodeScopeType.Class),
    });
  }

  createInternalGenericType(options: {
    identifier: string,
    writer: (typeParameters: BopFields) => BopType,
  }) {
    this.internalGenericTypeMap.set(options.identifier, options.writer);
  }

  private readonly internalIsFieldSet = new Set<string>([
    'x',
    'y',
    'z',
    'w',
  ]);

  createInternalType(options: {
    identifier: string,
    internalIdentifier?: string,
    anonymous?: boolean,
    isArrayOf?: BopType,
  }): BopInternalTypeBuilder {
    const typeBopVar = this.globalBlock.mapStorageIdentifier(options.identifier, this.typeType, /* anonymous */ true);
    const typeVar = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.typeType, BopIdentifierPrefix.Struct, options.identifier);
    const innerScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
    const innerBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
    this.writer.mapInternalToken(typeVar.identifierToken, options.internalIdentifier ?? options.identifier);

    // HACK!!! Use the mutability of arrays to allow us to mutate BopStructType after the fact.
    const fields: BopVariable[] = [];
    const declareField = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      fieldBopVar.result = fieldVar;
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      if (this.internalIsFieldSet.has(identifier)) {
        fields.push(fieldBopVar);
      }
      return fieldBopVar;
    };

    const declareInternalProperty = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      if (this.internalIsFieldSet.has(identifier)) {
        fields.push(fieldBopVar);
      }
      return fieldBopVar;
    };

    const newType = BopType.createPassByValue({
        debugName: options.identifier,
        valueType: CodeTypeSpec.fromStruct(typeVar.identifierToken),
        innerScope: innerScope,
        innerBlock: innerBlock,
        structOf: new BopStructType(fields),
        internalTypeOf: new BopInternalType(options.isArrayOf),
    });
    typeBopVar.typeResult = newType;

    if (!options.anonymous) {
      this.internalTypes.set(options.identifier, newType);
    }

    const declareFunction = (identifier: string, params: BopFields, returnType: BopType, options: { includeThis: boolean }) => {
      const bopFunctionType = new BopFunctionType(
        params,
        newType,
        /* isMethod */ options.includeThis,
        0,
      );

      let funcIdentifier;
      const oldFunc = innerBlock.identifierMap.get(identifier);
      if (oldFunc && oldFunc.bopType.functionOf && oldFunc.result) {
        funcIdentifier = oldFunc.result;
        oldFunc.bopType.functionOf.overloads.push(bopFunctionType);
      } else {
        const debugName = `${newType.debugName}.${identifier}`;
        funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Constructor, debugName);
        const funcType = BopType.createFunctionType({
          debugName: debugName,
          innerScope: innerScope.createChildScope(CodeScopeType.Local),
          innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
          functionOf: new BopFunctionOf([bopFunctionType]),
        });
        innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
      }

      // TODO: Allocate different identifier tokens for each overload.
      const funcWriter = this.writer.global.writeFunction(funcIdentifier.identifierToken);
      funcWriter.returnTypeSpec = returnType.storageType;
      return funcWriter;
    };

    const declareMethod = (identifier: string, params: BopFields, returnType: BopType) => {
      return declareFunction(identifier, params, returnType, { includeThis: true });
    };

    const declareConstructor = (params: BopFields) => {
      return declareFunction('constructor', params, newType, { includeThis: false });
    };

    const declareInternalField = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      fieldBopVar.result = fieldVar;
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      return fieldBopVar;
    };

    const declareInternalFunction = (identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType, options: { includeThis: boolean }) => {
      let funcIdentifier;
      let overloads: BopFunctionType[];
      const oldFunc = innerBlock.identifierMap.get(identifier);
      if (oldFunc && oldFunc.bopType.functionOf && oldFunc.result) {
        funcIdentifier = oldFunc.result;
        overloads = oldFunc.bopType.functionOf.overloads;
      } else {
        const debugName = `${newType.debugName}.${identifier}`;
        const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Method, debugName);
        overloads = [];
        const funcType = BopType.createFunctionType({
          debugName: debugName,
          innerScope: innerScope.createChildScope(CodeScopeType.Local),
          innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
          functionOf: new BopFunctionOf(overloads),
        });
        innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
        this.writer.mapInternalToken(funcIdentifier.identifierToken, internalIdentifier);
      }

      const bopFunctionType = new BopFunctionType(
        params,
        returnType,
        /* isMethod */ options.includeThis,
        overloads.length,
      );
      overloads.push(bopFunctionType);
      return;
    };

    const declareInternalMethod = (identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType, options: { isMethod: boolean }) => {
      return declareInternalFunction(identifier, internalIdentifier, params, returnType, { includeThis: options.isMethod });
    };

    const declareInternalConstructor = (params: BopFields, internalIdentifier: string) => {
      return declareInternalFunction('constructor', internalIdentifier, params, newType, { includeThis: false });
    };

    const declareGenericMethod = (identifier: string, genericFunc: BopGenericFunction) => {
      const debugName = `${newType.debugName}.${identifier}`;
      const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Method, debugName);
      innerBlock.mapTempIdentifier(identifier, this.functionType).genericFunctionResult = genericFunc;
      return;
    };

    return {
      type: newType,
      declareField,
      declareMethod,
      declareConstructor,
      declareInternalField,
      declareInternalMethod,
      declareInternalConstructor,
      declareGenericMethod,
      declareInternalProperty,
    };
  }


  private get currentFunctionConcreteImpl() {
    let block = this.block;
    while (block) {
      if (block.functionOfConcreteImpl) {
        return block.functionOfConcreteImpl;
      }
      if (!block.parent) {
        break;
      }
      block = block.parent;
    }
    return undefined;
  }


  private createInternalConstant(options: {
    identifier: string,
    internalIdentifier?: string,
    type: BopType,
  }): BopVariable {
    const constBopVar = this.globalBlock.mapStorageIdentifier(options.identifier, options.type);
    const constVar = this.writer.global.scope.allocateVariableIdentifier(options.type.storageType, BopIdentifierPrefix.Local, options.identifier);
    constBopVar.result = constVar;
    this.writer.mapInternalToken(constVar.identifierToken, options.internalIdentifier ?? options.identifier);
    return constBopVar;
  }

  verify<T>(value: T, errorFormatter: (() => string)|string, predicate?: (v: T) => boolean): T {
    const cond = predicate === undefined ? (!!value) : predicate(value);
    if (!cond) {
      let error: string;
      if (typeof(errorFormatter) === 'string') {
        error = errorFormatter;
      } else {
        error = errorFormatter();
      }
      this.logAssert(error);
    }
    return value;
  }

  logAssert(error: string) {
    console.error(error);
  }

  check(cond: boolean, errorFormatter: (() => string)|string): boolean {
    if (!cond) {
      let error: string;
      if (typeof(errorFormatter) === 'string') {
        error = errorFormatter;
      } else {
        error = errorFormatter();
      }
      this.logAssert(error);
    }
    return cond;
  }

  verifyNotNulllike<T>(cond: T|null|undefined, errorFormatter: (() => string)|string): cond is T {
    if (cond === null || cond === undefined) {
      let error: string;
      if (typeof(errorFormatter) === 'string') {
        error = errorFormatter;
      } else {
        error = errorFormatter();
      }
      this.logAssert(error);
      return false;
    }
    return true;
  }

  private visitTopLevelNode(node: ts.Node): BopStage|undefined {
    const getNodeLabel = (node: ts.Node) => { return tsGetSyntaxTypeLabel(node.kind) ?? 'Unknown'; };

    // console.log(node);
    const sourceMapRange = ts.getSourceMapRange(node);
    console.log(`${tsGetSyntaxTypeLabel(node.kind)}   inner code: ${(sourceMapRange.source ?? this.sourceRoot).text.substring(sourceMapRange.pos, sourceMapRange.end).trim()}`);

    const block = this.block;
    const asAssignableRef = this.asAssignableRef;

    const recurse = (child: ts.Node): BopStage => {
      const rawExpr = this.visitTopLevelNode(child);
      if (rawExpr) {
        this.block.children.push(rawExpr);
      }
      return rawExpr ?? {};
    }

    if (ts.isSourceFile(node)) {
      for (const statement of node.statements) {
        if (ts.isInterfaceDeclaration(statement)) {
          // const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
        } else if (ts.isClassDeclaration(statement)) {
          if (!this.verifyNotNulllike(statement.name, `Anonymous classes not supported.`)) {
            return;
          }
          const newType = this.resolveType(this.tc.getTypeAtLocation(statement));
        } else if (ts.isFunctionDeclaration(statement)) {
          this.declareFunction(statement, undefined, this.globalBlock, this.globalBlock);
        } else {
          this.logAssert(`Unsupported ${getNodeLabel(statement)} at global scope.`);
        }
      }
      return {};
    } else if (ts.isBlock(node)) {
      node.statements.forEach(recurse);
      return {};
    }
    this.logAssert(`Unsupported syntax ${getNodeLabel(node)}.`);

    return;
  };


  private visitBlockGenerator(node: ts.Node): BopStage|undefined {
    const sourceMapRange = ts.getSourceMapRange(node);
    console.log(`${tsGetSyntaxTypeLabel(node.kind)}   inner code: ${(sourceMapRange.source ?? this.sourceRoot).text.substring(sourceMapRange.pos, sourceMapRange.end).trim()}`);

    const block = this.block;
    const asAssignableRef = this.asAssignableRef;

    const createBopReference = (identifier: string, inBlock?: BopBlock): BopReference => {
      return new BopReference(identifier, inBlock ?? this.block);
    };
    const allocTmpOut = (type: CodeTypeSpec, bopType: BopType, nameHint?: string): [CodeVariable, BopVariable] => {
      const outBopVar = this.block.mapIdentifier(nameHint ?? 'tmp', type, bopType, /* anonymous */ true);
      const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, nameHint ?? getNodeLabel(node));
      outBopVar.result = outVar;
      return [outVar, outBopVar];
    };

    if (ts.isBlock(node)) {
      node.statements.forEach(this.visitChild.bind(this));
      return {};
    } else if (ts.isExpressionStatement(node)) {
      return this.delegateToChild(node.expression);
    } else if (ts.isVariableStatement(node) || ts.isVariableDeclarationList(node)) {
      const declarations = ts.isVariableDeclarationList(node) ? node.declarations : node.declarationList.declarations;
      const newVars = declarations.map(decl => {
        const initializer = this.visitChildOrNull(decl.initializer);
        const valueAuxType = initializer?.getAuxTypeInference?.();
        const varType = valueAuxType?.bopType ?? this.resolveType(this.tc.getTypeAtLocation(decl));
        const newVar = this.block.mapTempIdentifier(decl.name.getText(), varType);
        return {
          variable: newVar,
          initializer: initializer,
          type: varType,
          getAuxTypeInference() { return valueAuxType; },
        };
      });

      return {
        produceResult: () => {
          for (const newVar of newVars) {
            if (newVar.initializer) {
              const newVarResult = this.readResult(newVar.initializer);
              if (newVarResult.requiresDirectAccess) {
                newVar.variable.result = newVarResult.result;
                newVar.variable.requiresDirectAccess = true;
              } else {
                let [initializerVar, initializerBopVar] = this.writeCoersion(newVarResult, newVar.type, this.blockWriter);
                const outVar = this.blockWriter.scope.createVariableInScope(newVar.variable.type, newVar.variable.nameHint);
                const ret = this.blockWriter.writeVariableDeclaration(outVar);
                if (initializerVar) {
                  ret.initializer.writeExpression().writeVariableReference(initializerVar);
                }
                newVar.variable.result = outVar;
              }
            }
          }
          return {};
        },
      };
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const oldAsAssignableRef = this.asAssignableRef;
      this.asAssignableRef = true;
      const refExpr = this.visitChild(node.left);
      this.asAssignableRef = oldAsAssignableRef;

      if (!this.check(refExpr.isAssignableRef === true, `LHS expression is not assignable.`)) {
        return;
      }

      const valueExpr = this.visitChild(node.right);
      const valueAuxType = valueExpr.getAuxTypeInference?.();
      const assignType = valueAuxType?.bopType ?? this.resolveType(this.tc.getTypeAtLocation(node.left));

      return {
        produceResult: () => {
          const [value, valueRef] = this.writeCoersionFromExprPair(valueExpr, assignType, this.blockWriter);

          const refResult = this.readFullResult(refExpr);
          const propAccessor = refResult?.expressionResult?.propertyResult;
          if (propAccessor) {
            // This is calling a setter property.
            const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.setter, thisVar: refResult.thisResult, functionOf: propAccessor.setter.bopType.functionOf!.overloads[0] }), [value]);
            if (!callBop) {
              return;
            }
            this.doProduceResult(callBop);
            return { expressionResult: valueRef };
          }

          const oldAsAssignableRef = this.asAssignableRef;
          this.asAssignableRef = true;
          const [ref, refVar] = this.writeCoersionFromExprPair(refExpr, assignType, this.blockWriter);
          this.asAssignableRef = oldAsAssignableRef;

          const ret = this.blockWriter.writeAssignmentStatement();
          if (refVar.requiresDirectAccess) {
            // HACK!!! ???
            ret.ref.writeDereferenceExpr().value.writeVariableReferenceReference(ref);
          } else {
            ret.ref.writeVariableDereference(ref);
          }
          ret.value.writeVariableReference(value);
          return { expressionResult: valueRef };
        },
      };
    } else if (ts.isReturnStatement(node)) {
      const valueBop = this.visitChildOrNull(node.expression);
      return {
        produceResult: () => {
          if (valueBop) {
            // Coerce to return type.
            const returnType = this.scopeReturnType;
            const valueVar = this.writeCoersionFromExpr(valueBop, returnType, this.blockWriter);

            const ret = this.blockWriter.writeReturnStatement();
            ret.expr.writeVariableReference(valueVar);
          }
          return {};
        },
      };
    } else if (ts.isIfStatement(node)) {
      const condBop = this.visitChild(node.expression);
      const branches: BopBlock[] = [ this.visitInBlock(node.thenStatement, CodeScopeType.Local) ];
      if (node.elseStatement) {
        branches.push(this.visitInBlock(node.elseStatement, CodeScopeType.Local));
      }
      return {
        produceResult: () => {
          const condVar = this.writeCoersionFromExpr(condBop, this.booleanType, this.blockWriter);
          const ret = this.blockWriter.writeConditional(branches.length);
          ret.branches[0].condWriter.writeVariableReference(condVar);
          this.writeBlock(branches[0], ret.branches[0].blockWriter);
          return {};
        },
      };
    } else if (ts.isForOfStatement(node)) {
      if (!node.initializer ||
          !ts.isVariableDeclarationList(node.initializer) ||
          node.initializer.declarations.length !== 1) {
        this.logAssert(`Malformed for statement.`);
        return;
      }
      const variableDeclNode = node.initializer.declarations[0];
      const variableName = variableDeclNode.name.getText();
      const enumerableType = this.resolveType(this.tc.getTypeAtLocation(node.expression));
      const elementType = this.resolveType(this.tc.getTypeAtLocation(variableDeclNode));
      const elementRawType = enumerableType.internalTypeOf?.arrayOfType;
      if (!this.verifyNotNulllike(elementRawType, `Unsupported enumeration over ${enumerableType.debugName}.`)) {
        return;
      }

      const enumerableBop = this.visitChild(node.expression);
      const oldBlock = this.block;
      const innerBlock = oldBlock.createChildBlock(CodeScopeType.Local);
      const elementBopVar = innerBlock.mapTempIdentifier(variableName, elementType);

      this.block = innerBlock;
      const body = this.visitInBlock(node.statement, CodeScopeType.Local);
      this.block = oldBlock;

      return {
        produceResult: () => {
          const indexVar = this.blockWriter.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'index');
          const lengthVar = this.blockWriter.scope.allocateVariableIdentifier(CodeTypeSpec.intType, BopIdentifierPrefix.Local, 'length');
          this.blockWriter.writeVariableDeclaration(indexVar).initializer.writeExpression().writeLiteralInt(0);
          this.blockWriter.writeVariableDeclaration(lengthVar)
              .initializer.writeExpression().writePropertyAccess(this.writer.makeInternalToken('length'))
              .source.writeVariableReference(this.readResult(enumerableBop).result!);

          const whileLoop = this.blockWriter.writeWhileLoop();
          const whileCond = whileLoop.condition;
          const whileBody = whileLoop.body;

          const breakCond = whileBody.writeConditional(1).branches[0];
          const breakCondExpr = breakCond.condWriter.writeUnaryOperation(CodeUnaryOperator.LogicalNot).value.writeBinaryOperation(CodeBinaryOperator.LessThan);
          breakCondExpr.lhs.writeVariableReference(indexVar);
          breakCondExpr.rhs.writeVariableReference(lengthVar);
          breakCond.blockWriter.writeBreakStatement();

          const elementVar = whileBody.scope.allocateVariableIdentifier(elementBopVar.type, BopIdentifierPrefix.Local, elementBopVar.nameHint);
          elementBopVar.result = elementVar;
          const elementAccess = whileBody.writeVariableDeclaration(elementVar).initializer.writeExpression().writeIndexAccess();
          elementAccess.index.writeVariableReference(indexVar);
          elementAccess.source.writeVariableReference(this.readResult(enumerableBop).result!);
          whileCond.writeLiteralBool(true);

          const incrementStmt = whileBody.writeAssignmentStatement();
          incrementStmt.ref.writeVariableReference(indexVar);
          const incrementExpr = incrementStmt.value.writeBinaryOperation(CodeBinaryOperator.Add);
          incrementExpr.lhs.writeVariableReference(indexVar);
          incrementExpr.rhs.writeLiteralInt(1);

          this.writeBlock(body, whileBody);
          return {};
        },
      };
    } else if (ts.isForStatement(node)) {
      if (!(node.initializer && node.condition && node.incrementor)) {
        this.logAssert(`Malformed for statement.`);
        return;
      }
      const initializerBop = this.visitInBlock(node.initializer, CodeScopeType.Local);
      const oldBlock = this.block;
      this.block = initializerBop;
      const conditionBop = this.visitInBlockFull(node.condition, CodeScopeType.Local);
      const updateBop = this.visitInBlock(node.incrementor, CodeScopeType.Local);
      const body = this.visitInBlock(node.statement, CodeScopeType.Local);
      this.block = oldBlock;

      return {
        produceResult: () => {
          this.writeBlock(initializerBop, this.blockWriter);
          const whileLoop = this.blockWriter.writeWhileLoop();
          const whileCond = whileLoop.condition;
          const whileBody = whileLoop.body;
          whileCond.writeLiteralBool(true);
          this.writeBlock(conditionBop.block, whileBody);
          const condVar = this.writeCoersionFromExpr(conditionBop.bop, this.booleanType, whileBody);
          const breakCond = whileBody.writeConditional(1).branches[0];
          breakCond.condWriter.writeUnaryOperation(CodeUnaryOperator.LogicalNot).value.writeVariableReference(condVar);
          breakCond.blockWriter.writeBreakStatement();

          this.writeBlock(body, whileBody);
          this.writeBlock(updateBop, whileBody);
          return {};
        },
      };
    } else if (ts.isWhileStatement(node)) {
      const oldBlock = this.block;
      const innerBlock = oldBlock.createChildBlock(CodeScopeType.Local);
      this.block = innerBlock;
      const conditionBop = this.visitInBlockFull(node.expression, CodeScopeType.Local);
      const body = this.visitInBlock(node.statement, CodeScopeType.Local);
      this.block = oldBlock;

      return {
        produceResult: () => {
          const whileLoop = this.blockWriter.writeWhileLoop();
          const whileCond = whileLoop.condition;
          const whileBody = whileLoop.body;
          whileCond.writeLiteralBool(true);
          this.writeBlock(conditionBop.block, whileBody);
          const condVar = this.writeCoersionFromExpr(conditionBop.bop, this.booleanType, whileBody);
          const breakCond = whileBody.writeConditional(1).branches[0];
          breakCond.condWriter.writeUnaryOperation(CodeUnaryOperator.LogicalNot).value.writeVariableReference(condVar);
          breakCond.blockWriter.writeBreakStatement();

          this.writeBlock(body, whileBody);
          return {};
        },
      };
    } else if (ts.isPropertyAccessExpression(node)) {
      const fromBop = this.visitChild(node.expression);
      return {
        resolveIdentifiers: () => {
        },
        produceResult: () => {
          const fromBopVar = this.readResult(fromBop);
          const fromVar = fromBopVar.result!;
          const propertyRef = createBopReference(node.name.text, fromBopVar.lookupBlockOverride ?? fromBopVar.bopType.innerBlock);
          this.resolve(propertyRef);

          if (!this.verifyNotNulllike(propertyRef.resolvedRef, `Property ${propertyRef.identifier} is undefined.`)) {
            return;
          }
          const outBopType = propertyRef.resolvedRef.bopType;
          const isProperty = !!propertyRef.resolvedRef.propertyResult;
          let outType = propertyRef.resolvedRef.type;
          let isDirectAccess = false;
          if (asAssignableRef) {
            outType = outType.toReference();
            if (isProperty || outType.asPrimitive === CodePrimitiveType.Function) {
              isDirectAccess = true;
            }
          }
          if (propertyRef.resolvedRef.requiresDirectAccess) {
            isDirectAccess = true;
          }

          let outBopVar;
          if (isDirectAccess) {
            outBopVar = propertyRef.resolvedRef;
          } else {
            const propAccessor = propertyRef.resolvedRef.propertyResult;
            const propVar = propertyRef.resolvedRef.result;
            if (propAccessor) {
              // This is calling a getter property.
              const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.getter, thisVar: fromBopVar, functionOf: propAccessor.getter.bopType.functionOf!.overloads[0] }), []);
              if (!callBop) {
                return;
              }
              this.doProduceResult(callBop);
              const result = this.readResult(callBop);
              result.requiresDirectAccess = fromBopVar.requiresDirectAccess;
              return {
                expressionResult: result,
                thisResult: fromBopVar,
              };
            } else if (propVar) {
              const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType, node.name.text);
              outBopVar = outTmpBopVar;
              const ret = this.blockWriter.writeVariableDeclaration(outVar);
              let accessExpr = ret.initializer.writeExpression();
              if (fromBopVar.requiresDirectAccess) {
                accessExpr = accessExpr.writeDereferenceExpr().value;
              }
              let sourceExpr;
              if (fromBopVar.requiresDirectAccess) {
                sourceExpr = accessExpr.writePropertyReferenceAccess(propVar.identifierToken).source;
              } else {
                sourceExpr = accessExpr.writePropertyAccess(propVar.identifierToken).source;
              }
              sourceExpr.writeVariableReference(fromVar);
            } else {
              this.logAssert(`Property ${propertyRef.identifier} is undefined.`);
              return;
            }
            outBopVar.requiresDirectAccess = fromBopVar.requiresDirectAccess;
          }
          return {
            expressionResult: outBopVar,
            thisResult: fromBopVar,
          };
        },
        isAssignableRef: asAssignableRef && fromBop.isAssignableRef,
      };
    } else if (ts.isElementAccessExpression(node)) {
      const indexBop = this.visitChild(node.argumentExpression);
      const fromBop = this.visitChild(node.expression);
      const resultType = this.resolveType(this.tc.getTypeAtLocation(node));
      return {
        resolveIdentifiers: () => {
        },
        produceResult: () => {
          const indexBopVar = this.readResult(indexBop);
          const fromBopVar = this.readResult(fromBop);

          let outType = resultType.tempType;
          let isDirectAccess = false;
          if (asAssignableRef) {
            outType = outType.toReference();
            isDirectAccess = true;
          }

          const [accessVar, accessBopVar] = allocTmpOut(outType, resultType);
          const indexAccess = this.blockWriter.writeVariableDeclaration(accessVar).initializer.writeExpression().writeIndexAccess();
          indexAccess.source.writeVariableReference(fromBopVar.result!);
          indexAccess.index.writeVariableReference(indexBopVar.result!);
          accessBopVar.requiresDirectAccess = isDirectAccess;
          return {
            expressionResult: accessBopVar,
          };
        },
        isAssignableRef: asAssignableRef,
      };
    } else if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) {
      const identifierName = ts.isIdentifier(node) ? node.text : 'this';
      const varRef = createBopReference(identifierName);
      return {
        resolveIdentifiers: () => {
          this.resolve(varRef);
        },
        produceResult: () => {
          const inVar = varRef.resolvedRef?.result;
          const isInstance = !!inVar;
          const isStatic = varRef.resolvedRef?.type === CodeTypeSpec.typeType;
          const isValidContext = isInstance || isStatic || varRef.resolvedRef?.requiresDirectAccess;
          if (!varRef.resolvedRef || !isValidContext) {
            this.logAssert(`Identifier ${varRef.identifier} is undefined.`);
            return;
          }
          const outBopType = varRef.resolvedRef.bopType;
          let outType = isInstance ? inVar.typeSpec : CodeTypeSpec.compileErrorType;
          let isDirectAccess = false;
          if (isStatic) {
            isDirectAccess = true;
          } else if (asAssignableRef) {
            outType = outType.toReference();
            if (outType.asPrimitive === CodePrimitiveType.Function) {
              isDirectAccess = true;
            }
          }
          if (varRef.resolvedRef.requiresDirectAccess) {
            isDirectAccess = true;
          }
          let outBopVar;
          if (isDirectAccess) {
            outBopVar = varRef.resolvedRef;
          } else {
            const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType, identifierName);
            outBopVar = outTmpBopVar;
            const ret = this.blockWriter.writeVariableDeclaration(outVar);
            if (asAssignableRef) {
              ret.initializer.writeExpression().writeVariableReferenceReference(inVar!);
            } else {
              ret.initializer.writeExpression().writeVariableReference(inVar!);
            }
          }
          return { expressionResult: outBopVar };
        },
        isAssignableRef: asAssignableRef,
      };
    } else if (ts.isCallExpression(node)) {
      const callingFuncConcreteImpl = this.currentFunctionConcreteImpl;
      if (!this.verifyNotNulllike(callingFuncConcreteImpl, `Function calls from the global scope are not supported.`)) {
        return;
      }

      // Hacky special cases!!! These are necessary for now since specialized
      // generics handling, like vararg expansions are not supported.
      let specialHandling: BopStage|undefined;
      for (const specialHandler of this.specialHandlers) {
        specialHandling = specialHandler(node);
        if (specialHandling) {
          break;
        }
      }
      if (specialHandling) {
        return specialHandling;
      }

      // TODO: Resolve function expressions.
      const oldAsAssignableRef = this.asAssignableRef;
      this.asAssignableRef = true;
      const functionBop = this.visitChild(node.expression);
      this.asAssignableRef = oldAsAssignableRef;

      const candidatesOutArray: ts.Signature[] = [];
      const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments.length);
      if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
        return;
      }
      console.log(this.tc.signatureToString(functionSignature));

      let typeParameters: BopFields = [];
      const instantatedFromSignature = (functionSignature as any)?.target as ts.Signature|undefined;
      if (instantatedFromSignature?.typeParameters) {
        // Reverse map to extrapolate type parameters.
        const typeMapper = (((functionSignature as any).mapper) as tsTypeMapper|undefined);
        if (typeMapper) {
          typeParameters = instantatedFromSignature.typeParameters.map(t => utils.upcast({ identifier: t.symbol.name, type: this.resolveType(tsGetMappedType(t, typeMapper, this.tc)) }));
        }
      }

      let functionVar: BopVariable|undefined;
      return this.makeCallBop(node, () => {
        const functionExprResult = this.readFullResult(functionBop);
        const functionRef = functionExprResult?.expressionResult;
        const thisRef = functionExprResult?.thisResult;
        if (!functionRef) {
          return;
        }
        const genericFunction = functionRef?.genericFunctionResult;
        if (genericFunction) {
          functionVar = this.instantiateGenericFunction(genericFunction, typeParameters);
        }
        functionVar ??= functionRef;
        // const functionOf = functionVar.bopType.functionOf;
        const functionOf = this.resolveFunctionOverload(functionVar.bopType, functionSignature);
        if (!this.verifyNotNulllike(functionOf, `Expression is not callable.`)) {
          return;
        }
        if (functionOf.isMethod && !this.verifyNotNulllike(thisRef?.result, `Cannot call instance method in a static context.`)) {
          return;
        }
        if (functionOf.concreteImpl) {
          functionOf.concreteImpl.referencedFrom.add(callingFuncConcreteImpl);
          callingFuncConcreteImpl.references.add(functionOf.concreteImpl);
        }
        return { functionVar: functionVar, thisVar: thisRef, functionOf };
      }, node.arguments);
    } else if (ts.isObjectLiteralExpression(node)) {
      const willCoerceFieldsTo = new Map<string, CoersionRef>();
      const initializers: Array<{ field: string, valueBop: BopStage, propertyRef: () => BopReference }> = [];
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) {
          const field = p.name.getText();
          const valueBop = this.visitChild(p.initializer);
          initializers.push({ field, valueBop, propertyRef: utils.lazy(() => createBopReference(field, asType.innerBlock)) });
          willCoerceFieldsTo.set(field, { assignedFromBop: valueBop });
        } else {
          this.logAssert(`Unknown object literal syntax.`);
          continue;
        }
      }

      const asType = this.resolveType(this.tc.getTypeAtLocation(node), { willCoerceFieldsTo });
      // const storage = createStorage(asType);

      return {
        resolveIdentifiers: () => {
          initializers.forEach(e => this.resolve(e.propertyRef()));
        },
        // resolveStorage: () => {
        //   this.resolveStorage(storage);
        // },
        produceResult: () => {
          const initializerVars: Array<{ identifierToken: CodeNamedToken, valueVar: CodeVariable }> = [];
          for (const initializer of initializers) {
            const prop = initializer.propertyRef().resolvedRef;
            const propRef = prop?.result;
            if (!this.verifyNotNulllike(prop, `Property ${initializer.field} is undefined.`) ||
                !this.verifyNotNulllike(propRef, `Property ${initializer.field} is undefined.`)) {
              return;
            }
            initializerVars.push({ identifierToken: propRef.identifierToken, valueVar: this.writeCoersionFromExpr(initializer.valueBop, prop.bopType, this.blockWriter) });
          }

          const [outVar, outBopVar] = allocTmpOut(asType.tempType, asType, asType.debugName);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          for (const initializer of initializerVars) {
            ret.initializer.writeAssignStructField(initializer.identifierToken).value.writeVariableReference(initializer.valueVar);
          }
          return { expressionResult: outBopVar };
        },
      };
    } else if (ts.isNewExpression(node)) {
      // TODO: Resolve function expressions.
      if (!ts.isIdentifier(node.expression)) {
        this.logAssert(`Function expressions are not supported.`);
        return;
      }

      const candidatesOutArray: ts.Signature[] = [];
      const functionSignature = this.tc.getResolvedSignature(node, candidatesOutArray, node.arguments?.length);
      if (!this.verifyNotNulllike(functionSignature, `Function has unresolved signature.`)) {
        return;
      }
      console.log(this.tc.signatureToString(functionSignature));

      const type = this.resolveType(this.tc.getTypeAtLocation(node));
      return this.makeCallBop(node, () => {
        // TODO: Support constructor overloads.
        const constructorRef = createBopReference('constructor', type.innerBlock);
        this.resolve(constructorRef);
        const functionOf = this.resolveFunctionOverload(constructorRef.resolvedRef?.bopType, functionSignature);
        if (!this.verifyNotNulllike(constructorRef.resolvedRef, `Constructor for ${type.debugName} is undefined.`) ||
            !this.verifyNotNulllike(functionOf, `Constructor for ${type.debugName} is undefined.`)) {
          return;
        }
        return { functionVar: constructorRef.resolvedRef, thisVar: undefined, functionOf };
      }, node.arguments ?? []);
    } else if (ts.isPrefixUnaryExpression(node)) {
      const opType =
          // node.operator === ts.SyntaxKind.PlusPlusToken ? CodeUnaryOperator.PlusPlus :
          // node.operator === ts.SyntaxKind.MinusMinusToken ? CodeUnaryOperator.MinusMinus :
          node.operator === ts.SyntaxKind.PlusToken ? CodeUnaryOperator.Plus :
          node.operator === ts.SyntaxKind.MinusToken ? CodeUnaryOperator.Negate :
          node.operator === ts.SyntaxKind.TildeToken ? CodeUnaryOperator.BitwiseNegate :
          node.operator === ts.SyntaxKind.ExclamationToken ? CodeUnaryOperator.LogicalNot :
          undefined;
      if (!this.verifyNotNulllike(opType, `Unknown operator ${node.operator}.`)) {
        return;
      }

      const isLogicalOp =
          opType === CodeUnaryOperator.Negate ||
          false;

      const opName = utils.findEnumName(CodeUnaryOperator, opType);
      const customOperatorName = `operator${opName}`;

      const lhs = this.visitChild(node.operand);
      const lhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.operand), { allowWouldBeAny: true }));

      let exprType: BopType;
      let lhsType: BopType;
      let customOperator: { bopVar: BopVariable, functionOf: BopFunctionType }|undefined = undefined;
      const thisStage: BopStage = {
        getAuxTypeInference: () => {
          // TODO: Support operators with different type patterns.
          const lhsAuxType = lhs.getAuxTypeInference?.();
          const lhsCustomOperatorType = this.makeCustomOperatorType(lhsRawType, lhsAuxType);
          if (lhsCustomOperatorType) {
            const lhsCustomOperator = lhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
            const lhsOverloads = lhsCustomOperator?.bopType.functionOf?.overloads;
            if (lhsOverloads) {
              let overloads = lhsOverloads;
              const resolvedCustomOperator = this.resolveFunctionOverload(overloads, [ lhsCustomOperatorType ]);

              if (resolvedCustomOperator) {
                customOperator = { bopVar: lhsCustomOperator!, functionOf: resolvedCustomOperator };
                lhsType = resolvedCustomOperator.args[0].type;
                exprType = resolvedCustomOperator.returnType;
                return { bopType: resolvedCustomOperator.returnType };
              }
            }
          }

          if (isLogicalOp) {
            exprType = this.booleanType;
            lhsType = lhsCustomOperatorType ?? exprType;
            return {};
          }

          if (lhsAuxType) {
            const asInt = lhsAuxType?.numberType === BopInferredNumberType.Int;
            exprType = asInt ? this.intType : this.floatType;
          } else {
            exprType = this.resolveType(this.tc.getTypeAtLocation(node));
          }
          lhsType = exprType;
          return { numberType: exprType === this.intType ? BopInferredNumberType.Int : BopInferredNumberType.Float };
        },
        produceResult: () => {
          thisStage.getAuxTypeInference!();
          const lhsVar = this.writeCoersionFromExpr(lhs, lhsType, this.blockWriter);
          if (customOperator) {
            const resolvedFunc = { functionVar: customOperator.bopVar, thisVar: undefined, functionOf: customOperator.functionOf };
            const callBop = this.makeCallBop(node, () => resolvedFunc, [ lhsVar ]);
            if (!callBop) {
              return;
            }
            this.doProduceResult(callBop);
            return { expressionResult: this.readResult(callBop) };
          } else {
            const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType, opName);
            const ret = this.blockWriter.writeVariableDeclaration(outVar);
            const op = ret.initializer.writeExpression().writeUnaryOperation(opType);
            op.value.writeVariableReference(lhsVar);
            return { expressionResult: outBopVar };
          }
        },
      };
      return thisStage;
    } else if (ts.isBinaryExpression(node)) {
      const opType =
          ts.isPlusToken(node.operatorToken) ? CodeBinaryOperator.Add :
          ts.isMinusToken(node.operatorToken) ? CodeBinaryOperator.Subtract :
          ts.isAsteriskToken(node.operatorToken) ? CodeBinaryOperator.Multiply :
          node.operatorToken.kind === ts.SyntaxKind.SlashToken ? CodeBinaryOperator.Divide :
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ? CodeBinaryOperator.Equals :
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? CodeBinaryOperator.Equals :
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? CodeBinaryOperator.NotEquals :
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ? CodeBinaryOperator.NotEquals :
          node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken ? CodeBinaryOperator.GreaterThan :
          node.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken ? CodeBinaryOperator.GreaterThanEquals :
          node.operatorToken.kind === ts.SyntaxKind.LessThanToken ? CodeBinaryOperator.LessThan :
          node.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken ? CodeBinaryOperator.LessThanEquals :
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? CodeBinaryOperator.LogicalOr :
          node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? CodeBinaryOperator.LogicalAnd :
          undefined;
      if (!this.verifyNotNulllike(opType, `Unknown operator ${getNodeLabel(node.operatorToken)}.`)) {
        return;
      }

      const isLogicalOp =
          opType === CodeBinaryOperator.Equals ||
          opType === CodeBinaryOperator.NotEquals ||
          opType === CodeBinaryOperator.GreaterThan ||
          opType === CodeBinaryOperator.GreaterThanEquals ||
          opType === CodeBinaryOperator.LessThan ||
          opType === CodeBinaryOperator.LessThanEquals ||
          opType === CodeBinaryOperator.LogicalOr ||
          opType === CodeBinaryOperator.LogicalAnd ||
          false;

      const opName = utils.findEnumName(CodeBinaryOperator, opType);
      const customOperatorName = `operator${opName}`;

      const lhs = this.visitChild(node.left);
      const rhs = this.visitChild(node.right);
      const lhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.left), { allowWouldBeAny: true }));
      const rhsRawType = this.filterWouldBeAny(this.resolveType(this.tc.getTypeAtLocation(node.right), { allowWouldBeAny: true }));

      let exprType: BopType;
      let lhsType: BopType;
      let rhsType: BopType;
      let customOperator: { bopVar: BopVariable, functionOf: BopFunctionType }|undefined = undefined;
      const thisStage: BopStage = {
        getAuxTypeInference: () => {
          // TODO: Support operators with different type patterns.
          const lhsAuxType = lhs.getAuxTypeInference?.();
          const rhsAuxType = rhs.getAuxTypeInference?.();

          const lhsCustomOperatorType = this.makeCustomOperatorType(lhsRawType, lhsAuxType);
          const rhsCustomOperatorType = this.makeCustomOperatorType(rhsRawType, rhsAuxType);

          if (lhsCustomOperatorType && rhsCustomOperatorType) {
            const lhsCustomOperator = lhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
            const rhsCustomOperator = rhsCustomOperatorType?.innerBlock.identifierMap.get(customOperatorName);
            const lhsOverloads = lhsCustomOperator?.bopType.functionOf?.overloads;
            const rhsOverloads = rhsCustomOperator?.bopType.functionOf?.overloads;
            if (lhsOverloads || rhsOverloads) {
              let overloads;
              if (lhsOverloads && rhsOverloads) {
                overloads = lhsOverloads.concat(rhsOverloads);
              } else {
                overloads = lhsOverloads ?? rhsOverloads!;
              }
              const resolvedCustomOperator = this.resolveFunctionOverload(overloads, [ lhsCustomOperatorType, rhsCustomOperatorType ]);

              if (resolvedCustomOperator) {
                if (lhsOverloads?.includes(resolvedCustomOperator)) {
                  customOperator = { bopVar: lhsCustomOperator!, functionOf: resolvedCustomOperator };
                } else {
                  customOperator = { bopVar: rhsCustomOperator!, functionOf: resolvedCustomOperator };
                }
                lhsType = resolvedCustomOperator.args[0].type;
                rhsType = resolvedCustomOperator.args[1].type;
                exprType = resolvedCustomOperator.returnType;
                return { bopType: resolvedCustomOperator.returnType };
              }
            }
          }

          if (isLogicalOp) {
            exprType = this.booleanType;
            lhsType = lhsCustomOperatorType ?? exprType;
            rhsType = rhsCustomOperatorType ?? exprType;
            return {};
          }

          if (lhsAuxType || rhsAuxType) {
            const asInt = lhsAuxType?.numberType === BopInferredNumberType.Int && rhsAuxType?.numberType === BopInferredNumberType.Int;
            exprType = asInt ? this.intType : this.floatType;
          } else {
            exprType = this.resolveType(this.tc.getTypeAtLocation(node));
          }
          lhsType = exprType;
          rhsType = exprType;
          return { numberType: exprType === this.intType ? BopInferredNumberType.Int : BopInferredNumberType.Float };
        },
        produceResult: () => {
          thisStage.getAuxTypeInference!();
          const lhsVar = this.writeCoersionFromExpr(lhs, lhsType, this.blockWriter);
          const rhsVar = this.writeCoersionFromExpr(rhs, rhsType, this.blockWriter);
          if (customOperator) {
            const resolvedFunc = { functionVar: customOperator.bopVar, thisVar: undefined, functionOf: customOperator.functionOf };
            const callBop = this.makeCallBop(node, () => resolvedFunc, [ lhsVar, rhsVar ]);
            if (!callBop) {
              return;
            }
            this.doProduceResult(callBop);
            return { expressionResult: this.readResult(callBop) };
          } else {
            const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType, opName);
            const ret = this.blockWriter.writeVariableDeclaration(outVar);
            const op = ret.initializer.writeExpression().writeBinaryOperation(opType);
            op.lhs.writeVariableReference(lhsVar);
            op.rhs.writeVariableReference(rhsVar);
            return { expressionResult: outBopVar };
          }
        },
      };
      return thisStage;
    } else if (ts.isParenthesizedExpression(node)) {
      return this.delegateToChild(node.expression);
    } else if (ts.isNumericLiteral(node)) {
      const parsedInt = utils.parseIntOr(node.text);
      const parsedFloat = utils.parseFloatOr(node.text);
      // TODO: Bad!!!
      const asInt = !node.getText(this.sourceRoot).includes('.') && parsedInt === parsedFloat;
      return {
        produceResult: () => {
          const numberType = asInt ? this.intType : this.floatType;
          const [outVar, outBopVar] = allocTmpOut(numberType.storageType, numberType, node.text);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          if (asInt) {
            ret.initializer.writeExpression().writeLiteralInt(parsedInt ?? Number.NaN);
          } else {
            ret.initializer.writeExpression().writeLiteralFloat(parsedFloat ?? Number.NaN);
          }
          return { expressionResult: outBopVar };
        },
        getAuxTypeInference: () => {
          return { numberType: asInt ? BopInferredNumberType.Int : BopInferredNumberType.Float };
        },
      };
    } else if (
        node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword) {
      const isTrue = node.kind === ts.SyntaxKind.TrueKeyword;
      return {
        produceResult: () => {
          const [outVar, outBopVar] = allocTmpOut(this.booleanType.storageType, this.booleanType);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          ret.initializer.writeExpression().writeLiteralBool(isTrue);
          return { expressionResult: outBopVar };
        },
      };
    }
    this.logAssert(`Unsupported syntax ${getNodeLabel(node)}.`);

    return;
  };









  private writeCoersionFromExpr(stage: BopStage, type: BopType, blockWriter?: CodeStatementWriter): CodeVariable;
  private writeCoersionFromExpr(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): CodeVariable|undefined;
  private writeCoersionFromExpr(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): CodeVariable|undefined {
    const ret = this.writeCoersionFromExprPair(stage, type, blockWriter);
    if (!ret) {
      return undefined;
    }
    return ret[0];
  }
  private writeCoersionFromExprPair(stage: BopStage, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable];
  private writeCoersionFromExprPair(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable]|undefined;
  private writeCoersionFromExprPair(stage: BopStage|undefined, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable]|undefined {
    if (!stage) {
      return undefined;
    }
    return this.writeCoersion(this.readResult(stage), type, blockWriter);
  }

  private writeCoersion(source: BopVariable, type: BopType, blockWriter?: CodeStatementWriter): [CodeVariable, BopVariable] {
    blockWriter ??= this.blockWriter;
    if (!source.result) {
      const errorResult = this.readCompileError();
      return [errorResult.result!, errorResult];
    }
    if (type === source.bopType) {
      return [source.result, source];
    }

    const fromType = source.bopType;
    const toType = type;

    blockWriter ??= this.blockWriter;
    const outBopVar = this.block.mapTempIdentifier('coersion', toType, /* anonymous */ true);
    const outVar = blockWriter.scope.createVariableInScope(outBopVar.type, 'coersion');
    outBopVar.result = outVar;
    const init = blockWriter.writeVariableDeclaration(outVar);
    if (!fromType.internalTypeOf && !toType.internalTypeOf && fromType.structOf && toType.structOf) {
      for (const toField of toType.structOf.fields) {
        const fromField = fromType.innerBlock.identifierMap.get(toField.nameHint);
        if (this.verifyNotNulllike(fromField, `Unable to implicitly cast ${fromType.debugName} to ${toType.debugName}: field ${toField.nameHint} not found.`)) {
          init.initializer.writeAssignStructField(toField.result!.identifierToken).value.writePropertyAccess(fromField.result!.identifierToken).source.writeVariableReference(source.result);
        }
      }
    } else {
    // } else if (fromType.tempType.asPrimitive && toType.tempType.asPrimitive) {
      // TODO: Additional verification this cast is possible.
      init.initializer.writeExpression().writeCast(toType.tempType).source.writeVariableReference(source.result);
    // } else {
    //   this.logAssert(`Implicit cast invalid: from ${fromType.debugName} to ${toType.debugName}.`);
    }

    return [outBopVar.result, outBopVar];
  }


  resolveFunctionOverload(functionType: BopType|undefined, functionSignature: ts.Signature): BopFunctionType|undefined;
  resolveFunctionOverload(overloads: BopFunctionType[]|undefined, functionSignature: ts.Signature): BopFunctionType|undefined;
  resolveFunctionOverload(overloads: BopFunctionType[]|undefined, functionSignatureArgs: BopType[]): BopFunctionType|undefined;
  resolveFunctionOverload(funcDecl: BopType|BopFunctionType[]|undefined, functionSignature: ts.Signature|BopType[]): BopFunctionType|undefined {
    if (funcDecl === undefined) {
      return undefined;
    }
    let overloads: BopFunctionType[];
    if (funcDecl instanceof BopType) {
      if (!funcDecl?.functionOf || funcDecl.functionOf.overloads.length === 0) {
        return undefined;
      }
      overloads = funcDecl.functionOf.overloads;
    } else {
      overloads = funcDecl;
    }
    if (overloads.length === 1) {
      return overloads[0];
    }
    const signatureArgTypes = functionSignature instanceof Array ? functionSignature :
        functionSignature.parameters.map(t => this.resolveType(this.tc.getTypeOfSymbol(t)));
    for (const overload of overloads) {
      if (overload.args.length !== signatureArgTypes.length) {
        continue;
      }
      let matches = true;
      for (let i = 0; i < overload.args.length; ++i) {
        if (overload.args[i].type !== signatureArgTypes[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return overload;
      }
    }
  }

  private declareFunction(node: ts.FunctionLikeDeclarationBase, methodThisType: BopType|undefined, declareInBlock: BopBlock, lookupInBlock: BopBlock, instantiateWithTypeParameters?: BopFields): BopVariable|undefined {
    const isConstructor = ts.isConstructorDeclaration(node);
    let candidateFuncName = node.name?.getText();
    if (!candidateFuncName && isConstructor) {
      candidateFuncName = 'constructor';
    }
    if (!this.verifyNotNulllike(candidateFuncName, `Anonymous functions not supported.`)) {
      return;
    }
    if (!this.verifyNotNulllike(node.body, `Function has no body.`)) {
      return;
    }
    const funcName = candidateFuncName;
    const isMethod = !!methodThisType && !isConstructor;

    let returnTypeProvider: (block: BopBlock) => BopType;
    let parameterSignatures: Array<{ identifier: string, type: ts.Type, isAutoField: boolean }> = [];
    if (isConstructor) {
      returnTypeProvider = () => methodThisType!;

      for (const param of node.parameters) {
        const isField = param.modifiers?.some(m =>
            m.kind === ts.SyntaxKind.PrivateKeyword ||
            m.kind === ts.SyntaxKind.ProtectedKeyword ||
            m.kind === ts.SyntaxKind.PublicKeyword ||
            m.kind === ts.SyntaxKind.ReadonlyKeyword ||
            false
        ) ?? false;

        const paramName = param.name.getText();
        const paramType = this.tc.getTypeAtLocation(param);

        parameterSignatures.push({ identifier: paramName, type: paramType, isAutoField: isField });
      }
    } else {
      const funcType = this.tc.getTypeAtLocation(node);
      const signature = this.tc.getSignaturesOfType(funcType, ts.SignatureKind.Call).at(0);
      if (!this.verifyNotNulllike(signature, `Function has unknown signature.`)) {
        return;
      }
      for (const param of signature.parameters) {
        parameterSignatures.push({ identifier: param.name, type: this.tc.getTypeOfSymbol(param), isAutoField: false });
      }
      const returnType = signature.getReturnType();
      returnTypeProvider = block => this.resolveType(returnType, { inBlock: block });
    }

    const instantiateFunc = (typeParameters: BopFields, anonymous: boolean): BopVariable => {
      const paramDecls: BopFields = [];
      const params: { var: BopVariable, attribs?: CodeAttributeDecl[] }[] = [];
      const autoFields: Array<{ argRef: BopVariable, identifier: string }> = [];
      let constructorBopVar: BopVariable|undefined;
      let body: BopBlock;

      const functionBlock = lookupInBlock.createChildBlock(CodeScopeType.Function);
      if (isMethod) {
        params.push({ var: functionBlock.mapIdentifier('this', methodThisType.assignableRefType, methodThisType) });
      } else if (isConstructor) {
        constructorBopVar = functionBlock.mapIdentifier('this', methodThisType!.assignableRefType, methodThisType!);
      }
      for (const param of typeParameters) {
        functionBlock.mapTempIdentifier(param.identifier, this.typeType).typeResult = param.type;
      }

      let returnType: BopType;
      let paramRewriter: FuncMutatorFunc|undefined;
      let gpuBindings: GpuBindings|undefined;
      const userReturnType = returnTypeProvider(functionBlock);

      // TODO: HAXXORZZZ !!!!!
      const rewrite = bopRewriteShaderFunction.bind(this)({
        funcName,
        userReturnType,
        parameterSignatures,
        functionBlock,
      });
      if (rewrite) {
        returnType = rewrite.returnType ?? userReturnType;
        paramRewriter = rewrite.paramRewriter;
        paramDecls.push(...rewrite.paramDecls);
        params.push(...rewrite.params);
        gpuBindings = rewrite.gpuBindings;
      } else {
        returnType = userReturnType;
        for (const param of parameterSignatures) {
          const paramType = this.resolveType(param.type, { inBlock: functionBlock });
          paramDecls.push({ type: paramType, identifier: param.identifier });

          const argVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
          params.push({ var: argVar });

          if (param.isAutoField) {
            autoFields.push({ argRef: argVar, identifier: param.identifier });
          }
        }
      }

      const newFunctionType = BopType.createFunctionType({
        debugName: funcName,
        innerScope: this.writer.global.scope.createChildScope(CodeScopeType.Local),
        innerBlock: functionBlock.createChildBlock(CodeScopeType.Local),
        functionOf: new BopFunctionOf([new BopFunctionType(
          paramDecls,
          returnType,
          !!methodThisType,
          0,
        )]),
      });

      const concreteFunctionVar = declareInBlock.mapTempIdentifier(funcName, newFunctionType, anonymous ?? true);
      const concreteFunctionIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, funcName);
      concreteFunctionVar.result = concreteFunctionIdentifier;

      const concreteImpl = new BopFunctionConcreteImplDetail(concreteFunctionVar, { gpuBindings });
      // HACK!!!!!!!!
      if (funcName === 'drawTriangle') {
        concreteImpl.touchedByCpu = true;
      }
      this.bopFunctionConcreteImpls.push(concreteImpl);
      newFunctionType.functionOf!.overloads[0].concreteImpl = concreteImpl;
      functionBlock.functionOfConcreteImpl = concreteImpl;

      this.pushBlockGenerator(lookupInBlock, {
        unrollBlocks: () => {
          // Map type parameters.
          const oldBlock = this.block;
          this.block = newFunctionType.innerBlock;
          body = this.visitInBlock(node.body!, CodeScopeType.Function);
          this.block = oldBlock;
        },
        produceResult: () => {
          const funcWriter = this.writer.global.writeFunction(concreteFunctionIdentifier.identifierToken);
          funcWriter.touchedByProxy = {
            get touchedByCpu() { return concreteImpl.touchedByCpu; },
            get touchedByGpu() { return concreteImpl.touchedByGpu; },
          };

          let constructorOutVar;
          if (constructorBopVar) {
            constructorOutVar = funcWriter.body.scope.allocateVariableIdentifier(methodThisType!.storageType, BopIdentifierPrefix.Local, 'New');
            funcWriter.body.writeVariableDeclaration(constructorOutVar);
            constructorBopVar.result = constructorOutVar;
          }

          funcWriter.returnTypeSpec = returnType.tempType;
          for (const param of params) {
            const paramVar = param.var;
            paramVar.result = funcWriter.body.scope.allocateVariableIdentifier(paramVar.type, BopIdentifierPrefix.Local, paramVar.nameHint);
            funcWriter.addParam(paramVar.type, paramVar.result.identifierToken, { attribs: param.attribs });
          }
          paramRewriter?.(funcWriter);
          if (constructorOutVar) {
            for (const autoField of autoFields) {
              const fieldRef = new BopReference(autoField.identifier, methodThisType!.innerBlock);
              this.resolve(fieldRef);
              if (!this.verifyNotNulllike(fieldRef.resolvedRef?.result, `Field ${autoField.identifier} not found.`)) {
                return;
              }

              const assign = funcWriter.body.writeAssignmentStatement();
              assign.ref.writePropertyAccess(fieldRef.resolvedRef!.result.identifierToken).source.writeVariableReference(constructorOutVar);
              assign.value.writeVariableReference(autoField.argRef.result!);
            }
          }

          const oldReturnType = this.scopeReturnType;
          this.scopeReturnType = returnType;
          this.writeBlock(body, funcWriter.body);
          this.scopeReturnType = oldReturnType;

          if (constructorOutVar) {
            funcWriter.body.writeReturnStatement().expr.writeVariableReference(constructorOutVar);
          }

          return {};
        },
      });
      return concreteFunctionVar;
    };

    if (node.typeParameters && !instantiateWithTypeParameters) {
      const genericFunctionVar = declareInBlock.mapTempIdentifier(funcName, this.functionType);
      const genericFunctionIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, funcName);
      genericFunctionVar.result = genericFunctionIdentifier;

      genericFunctionVar.genericFunctionResult = new BopGenericFunction((typeParameters: BopFields) => {
        return instantiateFunc(typeParameters, /* anonymous */ true);
      });
      return genericFunctionVar;
    } else {
      return instantiateFunc(instantiateWithTypeParameters ?? [], /* anonymous */ false);
    }
  }

  private makeCallBop(node: ts.Node, funcGetter: () => { functionVar: BopVariable, thisVar: BopVariable|undefined, functionOf: BopFunctionType }|undefined, args: ArrayLike<ts.Expression|CodeVariable>): BopStage|undefined {
    const argBops: Array<BopStage|CodeVariable> = Array.from(args).map(e => {
      if (e instanceof CodeVariable) {
        return e;
      }
      return this.visitChild(e);
    });

    return {
      produceResult: () => {
        const inFunc = funcGetter();
        if (!inFunc?.functionVar || !inFunc?.functionVar.bopType.functionOf) {
          return;
        }

        const functionRef = inFunc.functionVar;
        const functionOf = inFunc.functionOf;
        const thisRef = inFunc.thisVar;
        if (functionOf.isMethod && !thisRef?.result) {
          return;
        }

        const argCount = Math.min(functionOf.args.length, argBops.length);
        const argVars: CodeVariable[] = [];
        for (let i = 0; i < argCount; ++i) {
          const argBop = argBops[i];
          const arg = functionOf.args[i];
          if (argBop instanceof CodeVariable) {
            argVars.push(argBop);
          } else {
            argVars.push(this.writeCoersionFromExpr(argBop, arg.type, this.blockWriter));
          }
        }
        const outBopVar = this.block.mapStorageIdentifier('tmp', functionOf.returnType, /* anonymous */ true);
        const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, inFunc.functionVar.nameHint ?? this.getNodeLabel(node));
        outBopVar.result = outVar;
        let callExprWriter;
        if (functionOf.returnType === this.voidType) {
          callExprWriter = this.blockWriter.writeExpressionStatement().expr;
        } else {
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          callExprWriter = ret.initializer.writeExpression();
        }
        const funcCall = callExprWriter.writeStaticFunctionCall(functionRef.result!.identifierToken, { overloadIndex: functionOf.overloadIndex, requiresDirectAccess: thisRef?.requiresDirectAccess });
        if (functionOf.isMethod) {
          if (thisRef!.requiresDirectAccess) {
            funcCall.addArg().writeVariableReferenceReference(thisRef!.result!);
          } else {
            funcCall.addArg().writeVariableReference(thisRef!.result!);
          }
        }
        for (const argVar of argVars) {
          funcCall.addArg().writeVariableReference(argVar);
        }
        return { expressionResult: outBopVar };
      },
    };
  }

  visitChild(child: ts.Node): BopStage {
    const rawExpr = this.visitBlockGenerator(child);
    if (rawExpr) {
      this.block.children.push(rawExpr);

      // Haxxor stuff.
      const innerGetAuxTypeInference = rawExpr.getAuxTypeInference;
      if (innerGetAuxTypeInference) {
        rawExpr.getAuxTypeInference = function (this: BopStage) {
          if (this.cachedAuxTypeInference) {
            return this.cachedAuxTypeInference;
          }
          this.cachedAuxTypeInference = innerGetAuxTypeInference();
          return this.cachedAuxTypeInference;
        };
      }

      // Haxxor debug stuff.
      const self = this;
      rawExpr.debugInfo = {
        sourceNode: child,
        get sourceCode(): string {
          const sourceMapRange = ts.getSourceMapRange(child);
          let sourceSnippetStr = (sourceMapRange.source ?? self.sourceRoot).text.substring(sourceMapRange.pos, sourceMapRange.end);
          return sourceSnippetStr;
        },
      };
      (rawExpr as any).toString = function (this: BopStage) {
        return this.debugInfo?.sourceCode;
      };
    }
    const newExpr = rawExpr ?? {};
    return newExpr;
  }

  visitChildOrNull(child: ts.Node|undefined): BopStage|undefined {
    if (!child) {
      return undefined;
    }
    return this.visitChild(child);
  }

  delegateToChild(child: ts.Node): BopStage {
    return this.visitBlockGenerator(child) ?? {};
  };

  visitInBlock(child: ts.Node, scopeType: CodeScopeType, childBlock?: BopBlock): BopBlock {
    return this.visitInBlockFull(child, scopeType, childBlock).block;
  }
  visitInBlockFull(child: ts.Node, scopeType: CodeScopeType, childBlock?: BopBlock): { block: BopBlock, bop: BopStage } {
    const oldBlock = this.block;
    const newBlock = childBlock ?? oldBlock.createChildBlock(scopeType);
    this.block = newBlock;
    const stage = this.visitChild(child);
    this.block = oldBlock;
    return { block: newBlock, bop: stage };
  };

  private pushBlockGenerator(parentBlock: BopBlock, generator: {
    unrollBlocks(): void,
    produceResult(): BopResult|undefined,
  }) {
    const oldBlock = this.block;
    const newBlock = parentBlock;
    this.block = newBlock;

    const oldUnrolledBlocks = this.unrolledBlocks;
    this.unrolledBlocks = [];
    generator.unrollBlocks();
    while (this.unrolledBlocks.length > 0) {
      console.log(this.unrolledBlocks);
      const toUnroll = this.unrolledBlocks;
      this.mapAndResolveRec(newBlock, toUnroll);
      this.unrolledBlocks = [];
    }
    this.unrolledBlocks = oldUnrolledBlocks;

    const generatorBlock = { produceResult: generator.produceResult };
    parentBlock.children.push(generatorBlock);
    this.unrolledBlocks?.push(generatorBlock);
    this.block = oldBlock;
  }

  private getNodeLabel(node: ts.Node) {
    return tsGetSyntaxTypeLabel(node.kind) ?? 'Unknown';
  }

  private resolve(ref: BopReference) {
    let block: BopBlock|undefined = ref.block;
    while (block) {
      const resolved = block.identifierMap.get(ref.identifier);
      if (resolved) {
        ref.resolvedRef = resolved;
        return;
      }
      block = block.parent;
    }
  }

  private instantiateGenericFunction(func: BopGenericFunction, typeParameters: BopFields): BopVariable {
    const structureKey = this.toStructureKey(typeParameters);
    let instance = func.instantiations.get(structureKey);
    if (!instance) {
      instance = new BopGenericFunctionInstance(typeParameters, func.instanceWriter(typeParameters));
      func.instantiations.set(structureKey, instance);
    }
    return instance.functionVar;
  }

  private writeBlock(block: BopBlock, blockWriter: CodeStatementWriter) {
    const oldBlock = this.blockWriter;
    this.blockWriter = blockWriter;
    for (const c of block.children) {
      if (c instanceof BopBlock) {
      } else {
        if (!c.resolvedIdentifiers) {
          c.resolvedIdentifiers = true;
          c.resolveIdentifiers?.();
        }
        this.doProduceResult(c);
      }
    }
    this.blockWriter = oldBlock;
  }

  private doProduceResult(stage: BopStage) {
    const result = stage.produceResult?.();
    if (result?.expressionResult) {
      this.resultMap.set(stage, result);
    }
  }

  readResult(stage: BopStage): BopVariable {
    const resultIdentifier = this.resultMap.get(stage);
    return resultIdentifier?.expressionResult ?? this.readCompileError();
  }

  readFullResult(stage: BopStage): BopResult|undefined {
    return this.resultMap.get(stage);
  }

  readCompileError(): BopVariable {
    const outVar = this.block.mapTempIdentifier('error', this.errorType, /* anonymous */ true);
    const identifier = this.blockWriter.scope.createVariableInScope(CodeTypeSpec.compileErrorType, 'error');
    outVar.result = identifier;
    this.blockWriter.writeVariableDeclaration(identifier);
    return outVar;
  }



  readonly typeMap = new Map<ts.Type, BopType>();
  private readonly typeGenericMap = new Map<ts.Type, Map<string, BopType>>();
  private readonly typeIdMap = new Map<CodeNamedToken|CodePrimitiveType, number>();
  private readonly typeCoalesceMap = new Map<string, {
    identifier: CodeVariable,
    innerScope: CodeScope,
    fieldIdentifierMap: Map<string, { fieldVar: CodeVariable, fieldType: BopType }>,
    defaultConstructor?: { fieldVar: CodeVariable, fieldType: BopType },
  }>();
  private readonly internalTypes = new Map<string, BopType>();
  private readonly internalGenericTypeMap = new Map<string, (typeParameters: BopFields) => BopType>();
  private readonly resolvingSet = new Map<ts.Type, void>();

  resolveType(type: ts.Type, options?: { inBlock?: BopBlock, willCoerceTo?: CoersionRef, willCoerceFieldsTo?: Map<string, CoersionRef>, allowWouldBeAny?: boolean }): BopType {
    const thisBlock = options?.inBlock ?? this.block;

    const isObject = (type.flags & ts.TypeFlags.Object) === ts.TypeFlags.Object;
    const objectFlags = isObject ? (type as ts.ObjectType).objectFlags : ts.ObjectFlags.None;
    const isReference = (objectFlags & ts.ObjectFlags.Reference) === ts.ObjectFlags.Reference;
    const isClassOrInterface = !!(objectFlags & ts.ObjectFlags.ClassOrInterface);
    const isGeneric = isReference && ((type as ts.TypeReference)?.typeArguments?.length ?? 0) > 0;
    const genericBase: ts.BaseType|undefined = isReference ? ((type as any).target as ts.TypeReference) : undefined;
    const isGenericBase = isGeneric && genericBase === type;
    if (isGenericBase) {
      return this.errorType;
    }
    const requiresGenericLookup = isReference;
    const isTypeParameter = type.isTypeParameter();
    const requiresFullLookup = requiresGenericLookup || isTypeParameter;

    let found = !requiresFullLookup && this.typeMap.get(type);
    // let found = this.typeMap.get(type) ?? this.typeSymbolMap.get(type.symbol);
    if (found) {
      return found;
    }

    if (type === this.tc.getNumberType()) {
      if (options?.willCoerceTo?.assignedFromBop) {
        const auxTypeInference = options.willCoerceTo.assignedFromBop.getAuxTypeInference?.();
        if (auxTypeInference?.numberType === BopInferredNumberType.Float) {
          return this.floatType;
        } else if (auxTypeInference?.numberType === BopInferredNumberType.Int) {
          return this.intType;
        }
      }
      return this.intType;
    }

    if ((type.flags & ts.TypeFlags.NumberLiteral) === ts.TypeFlags.NumberLiteral) {
      found = this.intType;
    } else if ((type.flags & ts.TypeFlags.BooleanLiteral) === ts.TypeFlags.BooleanLiteral) {
      found = this.booleanType;
    } else if ((type.flags & ts.TypeFlags.Undefined) === ts.TypeFlags.Undefined) {
      found = this.undefinedType;
    }
    if (found) {
      return found;
    }

    const parentScope = this.writer.global.scope;
    const parentBlock = this.globalBlock;
    const shortName = this.stringifyType(type);

    // Create a new type.
    if (!this.check((type.flags & ts.TypeFlags.Any) !== ts.TypeFlags.Any, `Type ${utils.stringEmptyToNull(shortName) ?? 'any'} is disallowed.`)) {
      return options?.allowWouldBeAny ? this.wouldBeAnyType : this.errorType;
    }
    if (!this.check(!this.resolvingSet.has(type), `Type ${shortName} is recursive.`)) {
      return this.errorType;
    }

    // Resolve types, that might contain type parameters.
    const resolveInnerTypeRef = (t: ts.Type): BopType|undefined => {
      if (!t.symbol) {
        return this.resolveType(t, { inBlock: thisBlock });
      }
      const typeRef = new BopReference(t.symbol.name, thisBlock);
      this.resolve(typeRef);
      if (typeRef.resolvedRef) {
        return typeRef.resolvedRef?.typeResult;
      }
      return this.resolveType(t, { inBlock: thisBlock });
    };

    if (isTypeParameter) {
      return resolveInnerTypeRef(type) ?? this.errorType;
    } else {
      // type.isTypeParameter() and the return confuses the type checker.
      type = type as ts.Type;
    }

    this.resolvingSet.set(type);
    const typeArgs: BopFields = [];
    try {
      // Lookup cached generic instantiations.
      let typeParamsKey = '';
      if (requiresGenericLookup) {
        const baseTypeArgs = (genericBase as ts.InterfaceType).typeParameters ?? [];
        const thisTypeArgs = (type as ts.TypeReference).typeArguments ?? [];
        if (!this.check(baseTypeArgs.length === thisTypeArgs.length, `Mismatching type arguments.`)) {
          return this.errorType;
        }
        for (let i = 0; i < baseTypeArgs.length; ++i) {
          const baseType = baseTypeArgs[i];
          const thisType = thisTypeArgs[i];
          const resolved = resolveInnerTypeRef(thisType) ?? this.errorType;
          typeArgs.push({
            identifier: baseType.symbol.name,
            type: resolved,
          });
        }
        typeParamsKey = this.toStructureKey(typeArgs);

        const genericInstances = this.typeGenericMap.get(genericBase!);
        if (genericInstances) {
          found = genericInstances.get(typeParamsKey);
        } else {
          found = undefined;
        }
        if (found) {
          return found;
        }
      }

      // Lookup internal types.
      const sourceFile = tsGetSourceFileOfNode(type.symbol?.declarations?.at(0));
      const isInternalDeclaration = sourceFile?.fileName?.toLowerCase()?.endsWith('.d.ts') ?? false;
      if (isInternalDeclaration) {
        // console.log(`     internal type mapping ========> ${type.symbol.name}`);
        const internalGenericType = this.internalGenericTypeMap.get(type.symbol.name);
        if (internalGenericType) {
          const instantiatedType = internalGenericType(typeArgs);
          let genericInstances = this.typeGenericMap.get(genericBase!);
          if (!genericInstances) {
            genericInstances = new Map();
            this.typeGenericMap.set(genericBase!, genericInstances);
          }
          genericInstances.set(typeParamsKey, instantiatedType);
          return instantiatedType;
        }
        return this.internalTypes.get(type.symbol.name) ?? this.errorType;
      }

      // Coalesce backing storage structs.
      const fields: BopFields = [];
      let constructorDecl: ts.ConstructorDeclaration|undefined;
      let methodDecls: ts.MethodDeclaration[] = [];
      for (const property of ((type as any).members as ts.SymbolTable) ?? type.symbol?.members ?? []) {
        const propertyName = property[0].toString();
        const propertySymbol = property[1];
        const propertyDecl = propertySymbol.declarations?.at(0);
        if (!this.verifyNotNulllike(propertyDecl, `Cannot determine type for property ${propertyName}.`)) {
          return this.errorType;
        }
        if (ts.isTypeParameterDeclaration(propertyDecl)) {
          continue;
        }
        if (ts.isMethodDeclaration(propertyDecl)) {
          methodDecls.push(propertyDecl);
          continue;
        }
        if (ts.isConstructorDeclaration(propertyDecl)) {
          continue;
        }
        let propertySymbolType = this.tc.getTypeOfSymbol(propertySymbol);
        let propertyType;
        if (propertySymbolType.isTypeParameter()) {
          propertyType = resolveInnerTypeRef(propertySymbolType);
        }
        propertyType ??= this.resolveType(propertySymbolType, { willCoerceTo: options?.willCoerceFieldsTo?.get(propertyName) });
        // const propertyType = this.resolveType(this.tc.getTypeAtLocation(propertyDecl));
        fields.push({ type: propertyType, identifier: propertyName });
      }
      // Sometimes the constructor disappears from everything but the symbol.
      for (const property of type.symbol?.members ?? []) {
        const propertyName = property[0].toString();
        const propertySymbol = property[1];
        const propertyDecl = propertySymbol.declarations?.at(0);
        if (!this.verifyNotNulllike(propertyDecl, `Cannot determine type for property ${propertyName}.`)) {
          return this.errorType;
        }
        if (ts.isConstructorDeclaration(propertyDecl)) {
          constructorDecl = propertyDecl;
          continue;
        }
      }

      let casesIdentifierMap: Map<BopType, { identifier: string, index: number }>|undefined;
      let caseVariableIdentifier: string|undefined;
      if (type.isUnion()) {
        casesIdentifierMap = new Map();

        const innerTypes = type.types.map(t => this.resolveType(t));
        let innerIndex = 0;
        for (const innerType of innerTypes) {
          if (casesIdentifierMap.has(innerType)) {
            continue;
          }
          const identifier = `${innerType.debugName}`;
          fields.push({ type: innerType, identifier });
          casesIdentifierMap.set(innerType, { identifier, index: innerIndex });
          innerIndex++;
        }

        caseVariableIdentifier = 'case';
        fields.push({ type: this.intType, identifier: caseVariableIdentifier });
      }

      const structureKey = this.toStructureKey(fields);

      let existingTypeInfo = this.typeCoalesceMap.get(structureKey);
      let fieldIdentifierMap: Map<string, { fieldVar: CodeVariable, fieldType: BopType }>;
      let identifier: CodeVariable;
      let innerScope: CodeScope;
      const methodFuncs: Array<() => void> = [];
      if (existingTypeInfo) {
        identifier = existingTypeInfo.identifier;
        innerScope = existingTypeInfo.innerScope;
        fieldIdentifierMap = existingTypeInfo.fieldIdentifierMap;
      } else {
        identifier = parentScope.allocateVariableIdentifier(CodeTypeSpec.typeType, BopIdentifierPrefix.Struct, shortName);
        innerScope = parentScope.createChildScope(CodeScopeType.Class);
        fieldIdentifierMap = new Map();
        existingTypeInfo = { identifier, innerScope, fieldIdentifierMap };
        this.typeCoalesceMap.set(structureKey, existingTypeInfo);

        const structWriter = this.writer.global.writeStruct(identifier.identifierToken).body;
        for (const property of fields) {
          const fieldIdentifier = innerScope.allocateVariableIdentifier(property.type.tempType, BopIdentifierPrefix.Field, property.identifier);
          structWriter.writeField(fieldIdentifier.identifierToken, property.type.tempType);
          fieldIdentifierMap.set(property.identifier, { fieldVar: fieldIdentifier, fieldType: property.type });
        }
        structWriter.writeStaticConstant(this.writer.makeInternalToken('marshalBytesInto'), CodeTypeSpec.functionType, () => {
          return structOf.marshalFunc;
        });
        structWriter.writeStaticConstant(this.writer.makeInternalToken('marshalByteStride'), CodeTypeSpec.functionType, () => {
          if (structOf.marshalLength === undefined) {
            return;
          }
          const value = structOf.marshalLength;
          return (expr: CodeExpressionWriter) => {
            expr.writeLiteralInt(value);
          };
        });

        for (const methodDecl of methodDecls) {
          methodFuncs.push(() => {
            const methodVar = this.declareFunction(methodDecl, newType, this.globalBlock, thisBlock, typeArgs);
            if (!methodVar) {
              return;
            }
          });
        }
      }

      let unionOf: BopTypeUnion|undefined;
      if (casesIdentifierMap && caseVariableIdentifier) {
        unionOf = new BopTypeUnion(
          new Map(Array.from(casesIdentifierMap.entries()).map(([type, entry]) => [ type, { caseVar: fieldIdentifierMap.get(entry.identifier)!.fieldVar, caseIndex: entry.index } ])),
          fieldIdentifierMap.get(caseVariableIdentifier)!.fieldVar,
        );
      }

      const innerBlock = parentBlock.createChildBlock(CodeScopeType.Class);
      const typeVar = parentBlock.mapStorageIdentifier(shortName, this.typeType);

      const fieldMap = new Map<string, BopVariable>();
      for (const property of fields) {
        const fieldIdentifier = fieldIdentifierMap.get(property.identifier)!;
        const fieldVar = innerBlock.mapIdentifier(property.identifier, fieldIdentifier.fieldVar.typeSpec, fieldIdentifier.fieldType);
        fieldVar.result = fieldIdentifier.fieldVar;
        fieldMap.set(property.identifier, fieldVar);
      }

      const structOf = new BopStructType(
        fields.map(f => fieldMap.get(f.identifier)!),
      );

      const newType = BopType.createPassByValue({
          debugName: shortName,
          valueType: CodeTypeSpec.fromStruct(identifier.identifierToken),
          innerScope,
          innerBlock,
          structOf,
      });
      if (requiresGenericLookup) {
        let genericInstances = this.typeGenericMap.get(genericBase!);
        if (!genericInstances) {
          genericInstances = new Map();
          this.typeGenericMap.set(genericBase!, genericInstances);
        }
        genericInstances.set(typeParamsKey, newType);
      } else {
        this.typeMap.set(type, newType);
      }
      typeVar.typeResult = newType;


      if (!constructorDecl && existingTypeInfo.defaultConstructor) {
        // Use the existing default constructor.
        const constructorIdentifier = existingTypeInfo.defaultConstructor;
        innerBlock.mapIdentifier('constructor', constructorIdentifier.fieldVar.typeSpec, constructorIdentifier.fieldType).result = constructorIdentifier.fieldVar;
      } else {
        if (!constructorDecl) {
          // Generate a default constructor.
          const constructorIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Constructor, shortName);
          const constructorFuncType = BopType.createFunctionType({
            debugName: `${shortName}.constructor`,
            innerScope: innerScope.createChildScope(CodeScopeType.Local),
            innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
            functionOf: new BopFunctionOf([new BopFunctionType(
              [],
              newType,
              /* isMethod */ false,
              0,
            )]),
          });
          existingTypeInfo.defaultConstructor = { fieldVar: constructorIdentifier, fieldType: constructorFuncType };

          innerBlock.mapIdentifier('constructor', constructorIdentifier.typeSpec, constructorFuncType).result = constructorIdentifier;
          const constructorWriter = this.writer.global.writeFunction(constructorIdentifier.identifierToken);
          constructorWriter.returnTypeSpec = newType.storageType;

          const constructorBlock = this.globalBlock.createChildBlock(CodeScopeType.Function);
          const constructorScope = this.writer.global.scope.createChildScope(CodeScopeType.Function);
          const constructorOutVar = constructorScope.allocateVariableIdentifier(newType.storageType, BopIdentifierPrefix.Local, 'New');
          constructorWriter.body.writeVariableDeclaration(constructorOutVar);
          constructorWriter.body.writeReturnStatement().expr.writeVariableReference(constructorOutVar);
        } else {
          // Roll out the constructor implementation.
          this.declareFunction(constructorDecl, newType, this.globalBlock, thisBlock, typeArgs);
        }
      }
      methodFuncs.forEach(f => f());

      return newType;
    } finally {
      this.resolvingSet.delete(type);
    }
  }

  private toStructureKey(fields: BopFields) {
    let structureKey = '';
    for (const entry of fields) {
      const lookupType = entry.type.tempType;
      let typeKey = lookupType.asPrimitive ?? lookupType.asStruct!;
      let typeId = this.typeIdMap.get(typeKey);
      if (typeId === undefined) {
        typeId = this.typeIdMap.size;
        this.typeIdMap.set(typeKey, typeId);
      }
      let structureKeyPart = `${entry.identifier}:${typeId},`;
      if (lookupType.isConst) {
        structureKeyPart = `const ${structureKeyPart}`;
      }
      if (lookupType.isReference) {
        structureKeyPart += '&';
      }
      if (lookupType.isPointer) {
        structureKeyPart += '*';
      }
      if (lookupType.isArray) {
        structureKeyPart += '[]';
      }
      structureKey += structureKeyPart;
    }
    return structureKey;
  }

  private getSymbolType(s: ts.Symbol|undefined) {
    if (s?.valueDeclaration) {
      return this.stringifyType(this.tc.getTypeAtLocation(s.valueDeclaration));
    }
    return '???';
  }

  private stringifyType(type: ts.Type): string {
      // console.log(this.tc.typeToString(type));
      // console.log(this.tc.typeToString(this.tc.getWidenedType(type)));
      // console.log((this.tc as any).getElementTypeOfArrayType(type));
    const isObject = (type.flags & ts.TypeFlags.Object) === ts.TypeFlags.Object && type.symbol;
    const objectFlags = isObject ? (type as ts.ObjectType).objectFlags : ts.ObjectFlags.None;
    const isReference = objectFlags & ts.ObjectFlags.Reference;
    const intrinsicType = (type as any)?.intrinsicName;
    const isError = intrinsicType === 'error';
    if (isError) {
      return '';
    } else if (intrinsicType) {
      return intrinsicType;
    } else if ((type.flags & ts.TypeFlags.Any) === ts.TypeFlags.Any) {
      return 'any';
    } else if (type.isUnion()) {
      return type.types.map(t => this.stringifyType(t)).join('|');
    } else if (type.isIntersection()) {
      return type.types.map(t => this.stringifyType(t)).join('&');
    } else if (type.isLiteral()) {
      return type.value.toString();
    } else if (type.isClassOrInterface()) {
      return type.symbol.name;
    } else if (isReference) {
      return `${type.symbol.name}<${(type as ts.TypeReference).typeArguments?.map(a => this.stringifyType(a)).join(',')}>`;
    } else if (isObject && this.tc.isArrayType(type)) {
      let elementType = isReference ? (type as ts.TypeReference).typeArguments?.at(0) : undefined;
      elementType ??= this.tc.getAnyType();
      return `${this.stringifyType(elementType)}[]`;
    } else if (isObject) {
      if ((type.symbol.flags & ts.SymbolFlags.Function) === ts.SymbolFlags.Function) {
        const signature = this.tc.getSignaturesOfType(type, ts.SignatureKind.Call).at(0);
        if (signature) {
          const returnType = signature.getReturnType();
          return `(${signature.getParameters().map(p => `${p.name}:${this.getSymbolType(p)}`).join(',')}) => ${this.stringifyType(returnType)}`;
        }
      }
      return `{${type.getProperties().map(p => `${p.name}:${this.getSymbolType(p)}`).join(',')}}`;
    }
    return type.symbol?.name ?? ((type as any)?.intrinsicName) ?? '';
  }

  private printRec(node: ts.Node) {
    const sourceMapRange = ts.getSourceMapRange(node);
    const resolvedType = this.tc.getTypeAtLocation(node);

    const nodeKindStr =
        tsGetSyntaxTypeLabel(node.kind)
        ?.replaceAll('Expression', 'Expr')
        ?.replaceAll('Literal', 'Lit')
        ?.replaceAll('Reference', 'Ref')
        ?.replaceAll('Variable', 'Var')
        ?.replaceAll('Declaration', 'Decl')
        ?.replaceAll('Statement', 'Stmt')
        ?.replaceAll('Token', 'Tok')
        ?.replaceAll('Assignment', 'Asgn')
        ?.replaceAll('Keyword', 'Kywd')
        ?.replaceAll('Property', 'Prop')
    let sourceSnippetStr = (sourceMapRange.source ?? this.sourceRoot).text.substring(sourceMapRange.pos, sourceMapRange.end).replaceAll('\n', '');
    const sourceSnippetLength = 32;
    if (sourceSnippetStr.length > (sourceSnippetLength + 2)) {
      sourceSnippetStr = sourceSnippetStr.substring(0, sourceSnippetLength) + ' …';
    }
    sourceSnippetStr = sourceSnippetStr.trim();
    console.log(`${nodeKindStr?.padEnd(16)}   ${this.stringifyType(resolvedType).padEnd(16)}  <=  ${sourceSnippetStr}`);
    // console.log(resolvedType);

    node.getChildren().forEach(this.printRec.bind(this));
  };

  filterWouldBeAny(type: BopType) {
    if (type === this.wouldBeAnyType) {
      return undefined;
    }
    return type;
  }

  private makeCustomOperatorType(rawType: BopType|undefined, auxType: BopAuxTypeInference|undefined): BopType|undefined {
    if (rawType && rawType !== this.intType && rawType !== this.floatType) {
      return rawType;
    }
    if (auxType) {
      const numberType = auxType.numberType;
      if (numberType === BopInferredNumberType.Int) {
        return this.intType;
      } else if (numberType === BopInferredNumberType.Float) {
        return this.floatType;
      }
      return auxType.bopType;
    }
    return rawType;
  };
}

