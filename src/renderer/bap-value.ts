import { BapChildScopeOptions, BapPrototypeScope, BapScope, BapThisSymbol } from "./bap-scope";
import { CodeStatementWriter, CodeExpressionWriter, CodeBinaryOperator, CodeWriter, CodeTypeSpec } from "./code-writer";

export interface BapSubtreeGenerator {
  generateRead(context: BapGenerateContext): BapSubtreeValue;
  generateWrite?(context: BapGenerateContext, value: BapSubtreeValue): BapWriteAsStatementFunc|undefined;
}

export class BapGenerateContext {
  rootContext: BapGenerateContext;
  constructor(
    parent: BapGenerateContext|undefined,
    readonly cache: BapGenerateCache,
    readonly platform: BapGeneratePlatformContext,
    readonly scope: BapScope,
    readonly globalWriter: CodeWriter,
  ) {
    this.rootContext = parent?.rootContext ?? this;
  }

  withChildScope(init?: BapChildScopeOptions) {
    const child = new BapGenerateContext(this, this.cache, this.platform, this.scope.child(init), this.globalWriter);
    if (init?.bindScope?.thisValue) {
      child.scope.bindContext = child;
      child.scope.declare(BapThisSymbol, init.bindScope.thisValue);
    }
    return child;
  }

  static root(globalWriter: CodeWriter) {
    return new BapGenerateContext(undefined, new BapGenerateCache(), { isGpu: false, platform: '' }, new BapScope(), globalWriter);
  }
}

export interface BapGeneratePlatformContext {
  isGpu: boolean;
  platform: string;
}

export class BapGenerateCache {
}

// export interface BapSubtree {
//   isLiteral: boolean;
//   isTypeLiteral: boolean;
//   isCached: boolean;
// }

export type BapSubtreeValue = BapLiteral|BapTypeLiteral|BapFunctionLiteral|BapCachedValue|BapEvalValue|BapStatementValue|BapUninitializedValue|BapErrorValue;
export type BapWriteIntoExpressionFunc = (prepare: CodeStatementWriter) => ((result: CodeExpressionWriter) => void)|undefined;
export type BapWriteAsStatementFunc = (prepare: CodeStatementWriter) => void;

export interface BapLiteral extends BapSubtreeValueBase {
  type: 'literal';
}

export interface BapTypeLiteral extends BapSubtreeValueBase {
  type: 'type';
  isGenericTypeParameter: boolean;
}

export interface BapFunctionLiteral extends BapSubtreeValueBase {
  type: 'function';
  resolve(args: BapSubtreeValue[], typeArgs: BapTypeLiteral[]): BapSubtreeValue;
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
}


export interface BapTypeGenerator {
  generate(context: BapGenerateContext): BapTypeSpec|undefined;
}

export interface BapTypeSpec {
  prototypeScope: BapPrototypeScope;
  codeTypeSpec: CodeTypeSpec;
}

export type BapFields = Array<{ type: BapTypeGenerator; identifier: string; }>;

