import { CodeStatementWriter, CodeExpressionWriter } from "./code-writer";

export interface BapSubtreeGenerator {
  generateRead(context: BapGenerateContext): BapSubtreeValue;
  generateWrite?(context: BapGenerateContext): void;
}

export class BapGenerateContext {
  constructor(
    readonly cache: BapGenerateCache,
    readonly platform: BapGeneratePlatformContext,
    readonly scope: BapScope,
  ) {}

  withChildScope() {
    return new BapGenerateContext(this.cache, this.platform, this.scope.child());
  }

  static root() {
    return new BapGenerateContext(new BapGenerateCache(), { isGpu: false, platform: '' }, new BapScope());
  }
}

type BapIdentifier = string|BapSpecialSymbol;
type BapSpecialSymbol = typeof BapThisSymbol|typeof BapReturnValueSymbol;
export class BapThisSymbol {};
export class BapReturnValueSymbol {};

export class BapScope {
  private readonly map = new Map<BapIdentifier, BapSubtreeValue>();
  private readonly children: BapScope[] = [];

  constructor(
    readonly parent?: BapScope,
  ) {}

  declare(identifier: BapIdentifier, value: BapSubtreeValue) {
    this.map.set(identifier, value);
  }

  assign(identifier: BapIdentifier, value: BapSubtreeValue) {
    if (this.map.has(identifier)) {
      // TODO: Add in conditional!!!
      this.map.set(identifier, value);
    } else {
      this.parent?.assign(identifier, value);
    }
  }

  resolve(identifier: BapIdentifier): BapSubtreeValue|undefined {
    return this.map.get(identifier) ?? this.parent?.resolve(identifier);
  }

  child(): BapScope {
    const childScope = new BapScope(this);
    this.children.push(childScope);
    return childScope;
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
  writeIntoExpression?(prepare: CodeStatementWriter): ((result: CodeExpressionWriter) => void)|undefined;
}

