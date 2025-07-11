import { BapChildScopeOptions, BapPrototypeScope, BapScope, BapThisSymbol } from "./bap-scope";
import { BapVisitor, BapVisitorRootContext } from "./bap-visitor";
import { GpuBindings } from './gpu-binding/gpu-bindings';
import { BapIdentifierPrefix } from "./bap-constants";
import { CodeStatementWriter, CodeExpressionWriter, CodeBinaryOperator, CodeWriter, CodeTypeSpec, CodeScope, CodeStructWriter, CodeVariable, CodeScopeType, CodeNamedToken } from "./code-writer/code-writer";

export interface BapSubtreeGenerator {
  generateRead(context: BapGenerateContext, options?: BapGenerateOptions): BapSubtreeValue;
  generateWrite?(context: BapGenerateContext, value: BapSubtreeValue): BapWriteAsStatementFunc|undefined;
  debug?: {
    trace: string;
    sourceCode: string;
  };
}

export class BapGenerateContext {
  rootContext: BapGenerateContext;
  constructor(
    parent: BapGenerateContext|undefined,
    readonly cache: BapGenerateCache,
    readonly platform: BapGeneratePlatformContext,
    readonly scope: BapScope,
    readonly globalWriter: CodeWriter,
    readonly instanceVars: {
      readonly codeVar: CodeVariable;
      readonly blockWriter: CodeStructWriter;
      readonly scope: CodeScope;
    },
  ) {
    this.rootContext = parent?.rootContext ?? this;
  }

  withChildScope(init?: BapChildScopeOptions) {
    const child = new BapGenerateContext(this, this.cache, this.platform, this.scope.child(init), this.globalWriter, this.instanceVars);
    if (init?.bindScope?.thisValue) {
      child.scope.bindContext = child;
      child.scope.declare(BapThisSymbol, init.bindScope.thisValue);
    }
    return child;
  }

  static root(init: {context: BapVisitorRootContext; globalWriter: CodeWriter; isGpu: boolean; }) {
    const { context, globalWriter, isGpu } = init;
    const instanceScope = globalWriter.global.scope.createChildScope(CodeScopeType.Class);
    const instanceVarsTypeIdentifier = globalWriter.makeInternalToken('InstanceVars');
    const instanceBlockWriter = globalWriter.global.writeStruct(instanceVarsTypeIdentifier);
    instanceBlockWriter.isInternalOnly = true;
    instanceBlockWriter.touchedByGpu = false;
    const instanceVarsToken = globalWriter.makeInternalToken('instanceVars');
    const instanceVarsIdentifier = globalWriter.global.scope.allocateVariableIdentifier(CodeTypeSpec.fromStruct(instanceVarsTypeIdentifier), BapIdentifierPrefix.Local, 'instanceVars', { fixedIdentifierToken: instanceVarsToken });

    const instanceVars = {
      codeVar: instanceVarsIdentifier,
      blockWriter: instanceBlockWriter,
      scope: instanceScope,
    };
    return new BapGenerateContext(undefined, new BapGenerateCache(), { isGpu: isGpu, platform: '' }, new BapScope(context), globalWriter, instanceVars);
  }
}

export interface BapGeneratePlatformContext {
  isGpu: boolean;
  platform: string;
}

export class BapGenerateCache {
}

export interface BapGenerateOptions {
  willCoerceTo?: BapTypeSpec;
  allowTypeParameters?: boolean;
}

export type BapSubtreeValue = BapLiteral|BapTypeLiteral|BapFunctionLiteral|BapCachedValue|BapEvalValue|BapStatementValue|BapUninitializedValue|BapErrorValue;
export type BapWriteIntoExpressionFunc = (prepare: CodeStatementWriter) => ((result: CodeExpressionWriter) => void)|undefined;
export type BapWriteIndexAccessIntoExpressionFunc = (prepare: CodeStatementWriter, indexValue: BapSubtreeValue) => ((result: CodeExpressionWriter) => void)|undefined;
export type BapWriteIndexAccessWriteIntoExpressionFunc = (prepare: CodeStatementWriter, indexValue: BapSubtreeValue, valueValue: BapSubtreeValue) => ((block: CodeStatementWriter) => void)|undefined;
export type BapWriteAsStatementFunc = (prepare: CodeStatementWriter) => ((block: CodeStatementWriter) => void)|undefined;

export interface BapLiteral extends BapSubtreeValueBase {
  type: 'literal';
}

export interface BapTypeLiteral extends BapSubtreeValueBase {
  type: 'type';
  isGenericTypeParameter: boolean;
  typeGen: BapTypeGenerator;
}

export interface BapFunctionLiteral extends BapSubtreeValueBase {
  type: 'function';
  debugName?: string;
  resolve(args: Array<BapSubtreeValue|undefined>, typeArgs: BapTypeSpec[]): BapSubtreeValue;
  generateGpuKernel?(): { token: CodeNamedToken; bindings: GpuBindings; }|undefined;
}

export interface BapCachedValue extends BapSubtreeValueBase {
  type: 'cached';
  generateWrite?(value: BapSubtreeValue): BapWriteAsStatementFunc|undefined;
}

export interface BapEvalValue extends BapSubtreeValueBase {
  type: 'eval';
}

export interface BapErrorValue extends BapSubtreeValueBase {
  type: 'error';
}

export interface BapStatementValue extends BapSubtreeValueBase {
  type: 'statement';
}

export interface BapUninitializedValue extends BapSubtreeValueBase {
  type: 'uninitialized';
}

export interface BapSubtreeValueBase {
  noCopy?: boolean;
  noPassAsArg?: boolean;
  typeSpec?: BapTypeSpec;
  writeIntoExpression?: BapWriteIntoExpressionFunc;
  writeIndexAccessIntoExpression?: BapWriteIndexAccessIntoExpressionFunc;
  writeIndexAccessWriteIntoExpression?: BapWriteIndexAccessWriteIntoExpressionFunc;
}


export interface BapTypeGenerator {
  generate(context: BapGenerateContext, options?: BapGenerateOptions): BapTypeSpec|undefined;
  debug?: {
    fixed?: BapTypeSpec;
    debugName?: string;
  };
}

export interface BapTypeSpec {
  userCodeIdentifier?: string;
  prototypeScope: BapPrototypeScope;
  staticScope: BapPrototypeScope;
  typeParameters: string[];
  codeTypeSpec: CodeTypeSpec;
  isShadow: boolean;
  debugName: string;
  libType?: {
    identifier: string;
    marshalSize?: number;
  };
  marshal?: {
    ensureMarshalable(fromVisitor: BapVisitor): void;
    blittable?: boolean;
  }
}

export type BapFields = Array<{ type: BapTypeSpec; identifier: string; }>;

