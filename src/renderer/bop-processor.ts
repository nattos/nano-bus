import * as utils from '../utils';
import * as ts from "typescript";
import { CodeAttributeDecl, CodeAttributeKey, CodeBinaryOperator, CodeFunctionWriter, CodeNamedToken, CodePrimitiveType, CodeScope, CodeScopeType, CodeStatementWriter, CodeStructBodyWriter, CodeStructWriter, CodeTypeSpec, CodeVariable, CodeWriter, CodeWriterPlatform } from './code-writer';
import { BopType, BopFunctionConcreteImplDetail, BopInternalTypeBuilder, BopFields, BopFunctionType, BopTypeUnion, BopStructType } from './bop-type';
import { getNodeLabel, tsGetMappedType, tsGetSourceFileOfNode, tsGetSyntaxTypeLabel, tsTypeMapper } from './ts-helpers';
import { BopBlock, BopStage, BopResult, BopIdentifierPrefix, BopGenericFunction, BopVariable, BopReference, BopGenericFunctionInstance, BopInferredNumberType } from './bop-data';
import { loadBopLib, toStringResolvedType } from './bop-lib-loader';
import { bopShaderBinding, expandShaderBindings } from './bop-shader-binding';
import { evalJavascriptInContext, SharedMTLInternals } from './bop-javascript-lib';
import { WGSL_LIB_CODE } from './bop-wgsl-lib';





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

  readonly errorType;
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
    this.instanceBlockWriter.touchedByGpu = false;
    const instanceVarsToken = this.writer.makeInternalToken('instanceVars');
    this.instanceVarsIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.fromStruct(instanceVarsTypeIdentifier), BopIdentifierPrefix.Local, 'instanceVars', { fixedIdentifierToken: instanceVarsToken });

    // Map intrinsic types.
    this.errorType = this.createPrimitiveType(CodeTypeSpec.compileErrorType);
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
F7_DrawTriangle_prepare();
F5_drawTriangle();
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

  createInternalType(options: {
    identifier: string,
    internalIdentifier?: string,
    anonymous?: boolean,
  }): BopInternalTypeBuilder {
    const typeBopVar = this.globalBlock.mapStorageIdentifier(options.identifier, this.typeType, /* anonymous */ true);
    const typeVar = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.typeType, BopIdentifierPrefix.Struct, options.identifier);
    const innerScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
    const innerBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
    this.writer.mapInternalToken(typeVar.identifierToken, options.internalIdentifier ?? options.identifier);

    const declareField = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      fieldBopVar.result = fieldVar;
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      return fieldBopVar;
    };

    const declareInternalProperty = (identifier: string, type: BopType) => {
      const fieldBopVar = innerBlock.mapIdentifier(identifier, type.storageType, type);
      const fieldVar = innerScope.allocateVariableIdentifier(fieldBopVar.type, BopIdentifierPrefix.Field, identifier);
      this.writer.mapInternalToken(fieldVar.identifierToken, identifier);
      return fieldBopVar;
    };

    const newType = BopType.createPassByValue({
        debugName: options.identifier,
        valueType: CodeTypeSpec.fromStruct(typeVar.identifierToken),
        innerScope: innerScope,
        innerBlock: innerBlock,
    });
    typeBopVar.typeResult = newType;

    if (!options.anonymous) {
      this.internalTypes.set(options.identifier, newType);
    }

    const declareFunction = (identifier: string, params: BopFields, returnType: BopType, options: { includeThis: boolean }) => {
      const debugName = `${newType.debugName}.${identifier}`;
      const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Constructor, debugName);
      const funcType = BopType.createFunctionType({
        debugName: debugName,
        innerScope: innerScope.createChildScope(CodeScopeType.Local),
        innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
        functionOf: new BopFunctionType(
          params,
          newType,
          /* isMethod */ options.includeThis,
        ),
      });

      innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
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
      const debugName = `${newType.debugName}.${identifier}`;
      const funcIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Method, debugName);
      const funcType = BopType.createFunctionType({
        debugName: debugName,
        innerScope: innerScope.createChildScope(CodeScopeType.Local),
        innerBlock: innerBlock.createChildBlock(CodeScopeType.Local),
        functionOf: new BopFunctionType(
          params,
          returnType,
          /* isMethod */ options.includeThis,
        ),
      });

      innerBlock.mapIdentifier(identifier, funcIdentifier.typeSpec, funcType).result = funcIdentifier;
      this.writer.mapInternalToken(funcIdentifier.identifierToken, internalIdentifier);
      return;
    };

    const declareInternalMethod = (identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType) => {
      return declareInternalFunction(identifier, internalIdentifier, params, returnType, { includeThis: true });
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
    const allocTmpOut = (type: CodeTypeSpec, bopType: BopType): [CodeVariable, BopVariable] => {
      const outBopVar = this.block.mapIdentifier('tmp', type, bopType, /* anonymous */ true);
      const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, getNodeLabel(node));
      outBopVar.result = outVar;
      return [outVar, outBopVar];
    };

    if (ts.isBlock(node)) {
      node.statements.forEach(this.visitChild.bind(this));
      return {};
    } else if (ts.isExpressionStatement(node)) {
      return this.delegateToChild(node.expression);
    } else if (ts.isVariableStatement(node)) {
      const newVars = node.declarationList.declarations.map(decl => {
        const varType = this.resolveType(this.tc.getTypeAtLocation(decl));
        const newVar = this.block.mapTempIdentifier(decl.name.getText(), varType);
        const initializer = this.visitChildOrNull(decl.initializer);
        return {
          variable: newVar,
          initializer: initializer,
          type: varType,
        };
      });

      return {
        produceResult: () => {
          for (const newVar of newVars) {
            let initializerVar = this.writeCoersionFromExpr(newVar.initializer, newVar.type, this.blockWriter);
            const outVar = this.blockWriter.scope.createVariableInScope(newVar.variable.type, newVar.variable.nameHint);
            const ret = this.blockWriter.writeVariableDeclaration(outVar);
            if (initializerVar) {
              ret.initializer.writeExpression().writeVariableReference(initializerVar);
            }
            newVar.variable.result = outVar;
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

      const assignType = this.resolveType(this.tc.getTypeAtLocation(node.left));
      const valueExpr = this.visitChild(node.right);

      return {
        produceResult: () => {
          const [value, valueRef] = this.writeCoersionFromExprPair(valueExpr, assignType, this.blockWriter);

          const refResult = this.readFullResult(refExpr);
          const propAccessor = refResult?.expressionResult?.propertyResult;
          if (propAccessor) {
            // This is calling a setter property.
            const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.setter, thisVar: refResult.thisResult }), [value]);
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
          ret.ref.writeVariableReference(ref);
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
    } else if (ts.isPropertyAccessExpression(node)) {
      const fromBop = this.visitChild(node.expression);
      return {
        resolveIdentifiers: () => {
        },
        produceResult: () => {
          const fromBopVar = this.readResult(fromBop);
          const fromVar = fromBopVar.result!;
          const propertyRef = createBopReference(node.name.text, fromBopVar.bopType.innerBlock);
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

          let outBopVar;
          if (isDirectAccess) {
            outBopVar = propertyRef.resolvedRef;
          } else {
            const propAccessor = propertyRef.resolvedRef.propertyResult;
            const propVar = propertyRef.resolvedRef.result;
            if (propAccessor) {
              // This is calling a getter property.
              const callBop = this.makeCallBop(node, () => utils.upcast({ functionVar: propAccessor.getter, thisVar: fromBopVar }), []);
              if (!callBop) {
                return;
              }
              this.doProduceResult(callBop);
              const result = this.readResult(callBop);
              return {
                expressionResult: result,
                thisResult: fromBopVar,
              };
            } else if (propVar) {
              const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType);
              outBopVar = outTmpBopVar;
              const ret = this.blockWriter.writeVariableDeclaration(outVar);
              ret.initializer.writeExpression().writePropertyAccess(propVar.identifierToken).source.writeVariableReference(fromVar);
            } else {
              this.logAssert(`Property ${propertyRef.identifier} is undefined.`);
              return;
            }
          }
          return {
            expressionResult: outBopVar,
            thisResult: fromBopVar,
          };
        },
        isAssignableRef: asAssignableRef && fromBop.isAssignableRef,
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
          const isValidContext = isInstance || isStatic;
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
          let outBopVar;
          if (isDirectAccess) {
            outBopVar = varRef.resolvedRef;
          } else {
            const [outVar, outTmpBopVar] = allocTmpOut(outType, outBopType);
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
        const functionOf = functionVar.bopType.functionOf;
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
        return { functionVar: functionVar, thisVar: thisRef };
      }, node.arguments);
    } else if (ts.isObjectLiteralExpression(node)) {
      const asType = this.resolveType(this.tc.getTypeAtLocation(node));
      // const storage = createStorage(asType);

      const initializers: Array<{ field: string, valueBop: BopStage, propertyRef: BopReference }> = [];
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) {
          const field = p.name.getText();
          const valueBop = this.visitChild(p.initializer);
          const propertyRef = createBopReference(field, asType.innerBlock);
          initializers.push({ field, valueBop, propertyRef });
        } else {
          this.logAssert(`Unknown object literal syntax.`);
          continue;
        }
      }

      return {
        resolveIdentifiers: () => {
          initializers.forEach(e => this.resolve(e.propertyRef));
        },
        // resolveStorage: () => {
        //   this.resolveStorage(storage);
        // },
        produceResult: () => {
          const initializerVars: Array<{ identifierToken: CodeNamedToken, valueVar: CodeVariable }> = [];
          for (const initializer of initializers) {
            const prop = initializer.propertyRef.resolvedRef;
            const propRef = prop?.result;
            if (!this.verifyNotNulllike(prop, `Property ${initializer.field} is undefined.`) ||
                !this.verifyNotNulllike(propRef, `Property ${initializer.field} is undefined.`)) {
              return;
            }
            initializerVars.push({ identifierToken: propRef.identifierToken, valueVar: this.writeCoersionFromExpr(initializer.valueBop, prop.bopType, this.blockWriter) });
          }

          const [outVar, outBopVar] = allocTmpOut(asType.tempType, asType);
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

      const type = this.resolveType(this.tc.getTypeAtLocation(node));
      return this.makeCallBop(node, () => {
        // TODO: Support constructor overloads.
        const constructorRef = createBopReference('constructor', type.innerBlock);
        this.resolve(constructorRef);
        if (!this.verifyNotNulllike(constructorRef.resolvedRef, `Constructor for ${type.debugName} is undefined.`) ||
            !this.verifyNotNulllike(constructorRef.resolvedRef.bopType.functionOf, `Constructor for ${type.debugName} is undefined.`)) {
          return;
        }
        return { functionVar: constructorRef.resolvedRef, thisVar: undefined };
      }, node.arguments ?? []);
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

      const lhs = this.visitChild(node.left);
      const rhs = this.visitChild(node.right);

      let exprType: BopType;
      let lhsType: BopType;
      let rhsType: BopType;
      const thisStage: BopStage = {
        getAuxTypeInference: () => {
          // TODO: Support operators with different type patterns.
          const lhsAuxType = lhs.getAuxTypeInference?.().numberType;
          const rhsAuxType = rhs.getAuxTypeInference?.().numberType;
          if (lhsAuxType || rhsAuxType) {
            const asInt = lhsAuxType === BopInferredNumberType.Int && rhsAuxType === BopInferredNumberType.Int;
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
          const [outVar, outBopVar] = allocTmpOut(exprType.storageType, exprType);
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          const op = ret.initializer.writeExpression().writeBinaryOperation(opType);
          op.lhs.writeVariableReference(lhsVar);
          op.rhs.writeVariableReference(rhsVar);
          return { expressionResult: outBopVar };
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
          const [outVar, outBopVar] = allocTmpOut(numberType.storageType, numberType);
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
    if (fromType.structOf && toType.structOf) {
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
      returnTypeProvider = block => this.resolveType(returnType, block);
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

      const userReturnType = returnTypeProvider(functionBlock);
      let returnType = userReturnType;

      type FuncMutatorFunc = (funcWriter: CodeFunctionWriter) => void;
      let paramRewriter: FuncMutatorFunc|undefined;

      // TODO: HAXXORZZZ !!!!!
      const isGpuVertexFunc = funcName.includes('vertexShader');
      const isGpuFragmentFunc = funcName.includes('fragmentShader');
      const isGpuBoundFunc = isGpuFragmentFunc || isGpuVertexFunc;
      if (isGpuBoundFunc) {
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

        if (this.verifyNotNulllike(returnType.structOf?.fields, `Vertex output is not concrete.`)) {
          const vertexOutStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_vertexOut`);
          const vertexOutStructWriter = this.writer.global.writeStruct(vertexOutStructIdentifier);
          const vertexOutStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
          const vertexOutStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
          vertexOutStructWriter.touchedByGpu = true;
          const vertexOutStructFields: BopVariable[] = [];

          let fieldIndex = 0;
          for (const field of returnType.structOf!.fields) {
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
            debugName: `${funcName}_vertexOut`,
            valueType: CodeTypeSpec.fromStruct(vertexOutStructIdentifier),
            innerScope: vertexOutStructScope,
            innerBlock: vertexOutStructBlock,
            structOf: new BopStructType(vertexOutStructFields),
          });

          returnType = vertexOutStructType;
        }

        const vertexStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_vertex`);
        const vertexStructWriter = this.writer.global.writeStruct(vertexStructIdentifier);
        const vertexStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
        const vertexStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
        vertexStructWriter.touchedByGpu = true;
        const vertexStructType = BopType.createPassByValue({
          debugName: `${funcName}_vertex`,
          valueType: CodeTypeSpec.fromStruct(vertexStructIdentifier),
          innerScope: vertexStructScope,
          innerBlock: vertexStructBlock,
        });

        const insStructIdentifier = this.writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Struct, `${funcName}_ins`);
        const insStructWriter = this.writer.global.writeStruct(insStructIdentifier);
        insStructWriter.touchedByGpu = true;
        const insStructScope = this.writer.global.scope.createChildScope(CodeScopeType.Class);
        const insStructBlock = this.globalBlock.createChildBlock(CodeScopeType.Class);
        insStructWriter.touchedByGpu = true;
        const insStructType = BopType.createPassByValue({
          debugName: `${funcName}_ins`,
          valueType: CodeTypeSpec.fromStruct(insStructIdentifier),
          innerScope: insStructScope,
          innerBlock: insStructBlock,
        });

        let paramIndex = 0;
        for (const param of parameterSignatures) {
          const paramType = this.resolveType(param.type, functionBlock);
          paramDecls.push({ type: paramType, identifier: param.identifier });

          if (paramIndex === 0) {
            if (!this.verifyNotNulllike(paramType.structOf?.fields, `Vertex is not concrete.`)) {
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
            const paramType = this.resolveType(param.type, functionBlock);
            const uniformBopVar = this.globalBlock.mapStorageIdentifier('testTest', paramType);
            uniformBopVar.result = this.writer.global.scope.allocateVariableIdentifier(paramType.storageType, BopIdentifierPrefix.Local, param.identifier);
            const argVar = functionBlock.mapTempIdentifier(param.identifier, paramType);
            argVar.result = uniformBopVar.result;

            const varWriter = this.writer.global.writeVariableDeclaration(uniformBopVar.result);
            varWriter.attribs.push({ key: CodeAttributeKey.GpuBindingLocation, intValue: 0 });
            varWriter.attribs.push({ key: CodeAttributeKey.GpuVarUniform });

          }
          paramIndex++;
        }
        paramRewriter = (funcWriter) => {
          for (const rewriter of rewriterFuncs) {
            rewriter(funcWriter);
          }
        };

        // Grrr... WebGPU disallows empty structs.
        if (vertexStructWriter.body.fieldCount === 0) {
          vertexStructWriter.body.writeField(vertexStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
        }
        if (insStructWriter.body.fieldCount === 0) {
          insStructWriter.body.writeField(insStructScope.allocateIdentifier(BopIdentifierPrefix.Field, 'placeholder'), this.intType.tempType);
        }

        console.log(expandShaderBindings(paramDecls, this.writer.global.scope));
      } else {
        for (const param of parameterSignatures) {
          const paramType = this.resolveType(param.type, functionBlock);
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
        functionOf: new BopFunctionType(
          paramDecls,
          returnType,
          !!methodThisType,
        ),
      });

      const concreteFunctionVar = declareInBlock.mapTempIdentifier(funcName, newFunctionType, anonymous ?? true);
      const concreteFunctionIdentifier = this.writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.functionType, BopIdentifierPrefix.Function, funcName);
      concreteFunctionVar.result = concreteFunctionIdentifier;

      const concreteImpl = new BopFunctionConcreteImplDetail(concreteFunctionVar);
      // HACK!!!!!!!!
      if (funcName === 'drawTriangle') {
        concreteImpl.touchedByCpu = true;
      }
      this.bopFunctionConcreteImpls.push(concreteImpl);
      newFunctionType.functionOf!.concreteImpl = concreteImpl;
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

  private makeCallBop(node: ts.Node, funcGetter: () => { functionVar: BopVariable, thisVar: BopVariable|undefined }|undefined, args: ArrayLike<ts.Expression|CodeVariable>): BopStage|undefined {
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
        const functionOf: BopFunctionType = inFunc?.functionVar.bopType.functionOf;
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
        const outVar = this.blockWriter.scope.createVariableInScope(outBopVar.type, this.getNodeLabel(node));
        outBopVar.result = outVar;
        let callExprWriter;
        if (functionOf.returnType === this.voidType) {
          callExprWriter = this.blockWriter.writeExpressionStatement().expr;
        } else {
          const ret = this.blockWriter.writeVariableDeclaration(outVar);
          callExprWriter = ret.initializer.writeExpression();
        }
        const funcCall = callExprWriter.writeStaticFunctionCall(functionRef.result!.identifierToken);
        if (functionOf.isMethod) {
          funcCall.addArg().writeVariableReference(thisRef!.result!);
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
    const oldBlock = this.block;
    const newBlock = childBlock ?? oldBlock.createChildBlock(scopeType);
    this.block = newBlock;
    this.visitChild(child);
    this.block = oldBlock;
    return newBlock;
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

  resolveType(type: ts.Type, inBlock?: BopBlock): BopType {
    const thisBlock = inBlock ?? this.block;

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
      console.log(`IS NUMBER LA`, type);
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
      return this.errorType;
    }
    if (!this.check(!this.resolvingSet.has(type), `Type ${shortName} is recursive.`)) {
      return this.errorType;
    }

    // Resolve types, that might contain type parameters.
    const resolveInnerTypeRef = (t: ts.Type): BopType|undefined => {
      if (!t.symbol) {
        return this.resolveType(t, thisBlock);
      }
      const typeRef = new BopReference(t.symbol.name, thisBlock);
      this.resolve(typeRef);
      if (typeRef.resolvedRef) {
        return typeRef.resolvedRef?.typeResult;
      }
      return this.resolveType(t, thisBlock);
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
        propertyType ??= this.resolveType(propertySymbolType);
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
      console.log(structureKey);

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

      const structOf: BopStructType = {
        fields: fields.map(f => fieldMap.get(f.identifier)!),
      };

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
            functionOf: new BopFunctionType(
              [],
              newType,
              /* isMethod */ false,
            ),
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
}

