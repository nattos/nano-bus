import { BapGenerateContext, BapSubtreeGenerator, BapSubtreeValue } from "./bap-value";
import { BapVisitor } from "./bap-visitor";
import { CodeStatementWriter, CodeBinaryOperator, CodeNamedToken, CodePrimitiveType } from "./code-writer";

export type BapIdentifier = string|BapSpecialSymbol;
export type BapSpecialSymbol = typeof BapThisSymbol|typeof BapReturnValueSymbol|typeof BapBreakBreakFlagSymbol;
export class BapThisSymbol {};
export class BapReturnValueSymbol {};
export class BapBreakBreakFlagSymbol {};
export function bapIdentifierToNameHint(identifier: BapIdentifier): string {
  if (typeof identifier === 'string') {
    return identifier;
  }
  switch (identifier) {
    case BapThisSymbol: return 'this';
    case BapReturnValueSymbol: return 'return';
    case BapBreakBreakFlagSymbol: return 'break';
  }
  return 'var';
}

export interface BapChildScopeOptions {
  cond?: BapSubtreeValue;
  controlFlowScope?: BapControlFlowScope;
  bindScope?: { thisValue?: BapSubtreeValue; };
}

export interface BapControlFlowScope {
  type: BapControlFlowScopeType;
  preContinue?: BapSubtreeGenerator;
  preBreak?: BapSubtreeGenerator;
  preBreakBreak?: BapSubtreeGenerator;
  preFinally?: BapSubtreeGenerator;
}

export enum BapControlFlowScopeType {
  Loop = 'loop',
  Function = 'func',
}

export class BapIdentifierInstance {
  constructor(readonly nameHint: string) {}

  toString() {
    return this.nameHint;
  }
}

export class BapPrototypeScope {
  private readonly map = new Map<BapIdentifier, { gen: BapSubtreeGenerator; token: CodeNamedToken; }>();
  declare(identifier: BapIdentifier, token: CodeNamedToken, gen: BapSubtreeGenerator) {
    this.map.set(identifier, { gen: gen, token: token });
  }

  resolve(identifier: BapIdentifier): BapSubtreeGenerator|undefined {
    return this.map.get(identifier)?.gen;
  }

  resolveCodeToken(identifier: BapIdentifier): CodeNamedToken|undefined {
    return this.map.get(identifier)?.token;
  }
}

export class BapScope {
  private readonly map = new Map<BapIdentifier, { value: BapSubtreeValue; instance: BapIdentifierInstance; }>();
  private readonly referenced = new Set<BapIdentifierInstance>();
  readonly referencedInChildren = new Set<BapIdentifierInstance>();
  private readonly children: BapScope[] = [];
  bindContext?: BapGenerateContext;

  constructor(
    readonly parent?: BapScope,
    readonly cond?: BapSubtreeValue,
    readonly controlFlowScope?: BapControlFlowScope,
    readonly bindScope?: { thisValue?: BapSubtreeValue; },
  ) {}

  declare(identifier: BapIdentifier, value: BapSubtreeValue) {
    const instance = new BapIdentifierInstance(bapIdentifierToNameHint(identifier));
    this.map.set(identifier, { value: value, instance: instance });
    return instance;
  }

  assign(identifier: BapIdentifier, value: BapSubtreeValue) {
    let condVars: BapSubtreeValue[] = [];
    {
      let scope: BapScope|undefined = this;
      while (scope) {
        if (scope.cond) {
          condVars.push(scope.cond);
        }
        scope = scope.parent;
      }
    }
    condVars.reverse();

    {
      let scope: BapScope|undefined = this;
      let refScopes: BapScope[] = [];
      let oldValue: { value: BapSubtreeValue; instance: BapIdentifierInstance; }|undefined = undefined;
      while (scope) {
        refScopes.push(scope);
        oldValue = scope.map.get(identifier);
        if (oldValue) {
          break;
        }
        scope = scope.parent;
      }
      if (!oldValue || !scope) {
        return;
      }

      this.markReferenced(oldValue.instance, refScopes);
      let condValue: BapSubtreeValue = value;
      if (condVars.length > 0) {
        condValue = {
          type: 'eval',
          typeSpec: BapVisitor.primitiveTypeSpec(CodePrimitiveType.Bool),
          writeIntoExpression(prepare: CodeStatementWriter) {
            const condVarsWriters = condVars.map(condVar => condVar.writeIntoExpression?.(prepare));
            const thenValueWriter = value.writeIntoExpression?.(prepare);
            const elseValueWriter = oldValue!.value.writeIntoExpression?.(prepare);
            return (expr) => {
              const branchExpr = expr.writeInlineConditional();
              let condLeafExpr = branchExpr.cond;
              for (let i = 0; i < condVarsWriters.length - 1; ++i) {
                const andExpr = condLeafExpr.writeBinaryOperation(CodeBinaryOperator.LogicalAnd);
                condVarsWriters[i]?.(andExpr.lhs);
                condLeafExpr = andExpr.rhs;
              }
              condVarsWriters.at(-1)?.(condLeafExpr);
              thenValueWriter?.(branchExpr.then);
              elseValueWriter?.(branchExpr.else);
            };
          }
        };
      }
      scope.map.set(identifier, { value: condValue, instance: new BapIdentifierInstance('cond') });
      return;
    }
  }

  resolve(identifier: BapIdentifier): BapSubtreeValue|undefined {
    let scope: BapScope|undefined = this;
    let refScopes: BapScope[] = [];
    let value = undefined;
    let prototypeValue = undefined;
    while (scope) {
      refScopes.push(scope);
      value = scope.map.get(identifier);
      if (value) {
        break;
      }
      prototypeValue = this.bindScope?.thisValue?.typeSpec?.prototypeScope?.resolve(identifier);
      if (prototypeValue) {
        break;
      }
      scope = scope.parent;
    }
    if (value) {
      this.markReferenced(value.instance, refScopes);
      return value.value;
    }
    if (prototypeValue && this.bindContext) {
      return prototypeValue.generateRead(this.bindContext);
    }
    return;
  }

  private markReferenced(instance: BapIdentifierInstance, refScopes: BapScope[]) {
    for (const refScope of refScopes) {
      refScope.referencedInChildren.add(instance);
    }
    this.referenced.add(instance);
  }

  resolveControlFlowScopes(stopAtType: BapControlFlowScopeType): BapControlFlowScope[]|undefined {
    let scope: BapScope|undefined = this;
    let collectedControlFlows: BapControlFlowScope[] = [];
    while (scope) {
      if (scope.controlFlowScope) {
        collectedControlFlows.push(scope.controlFlowScope);
        if (scope.controlFlowScope.type === stopAtType) {
          return collectedControlFlows;
        }
      }
      scope = scope.parent;
    }
  }

  child(init?: BapChildScopeOptions): BapScope {
    const childScope = new BapScope(
      this,
      init?.cond,
      init?.controlFlowScope,
      init?.bindScope,
    );
    this.children.push(childScope);
    return childScope;
  }
}
