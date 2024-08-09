import { BopFields, BopType, BopFunctionConcreteImplDetail } from "./bop-type";
import { CodeVariable, CodeTypeSpec, CodeScopeType } from "./code-writer";

export interface BopResult {
  expressionResult?: BopVariable;
  thisResult?: BopVariable;
}

export interface BopStage {
  createScopes?(): void;
  mapIdentifiers?(): void;
  resolveIdentifiers?(): void;
  resolveStorage?(): void;
  produceResult?(): BopResult|undefined;

  isAssignableRef?: boolean;

  resolvedIdentifiers?: boolean;
}

export class BopGenericFunctionInstance {
  constructor(
    public readonly typeParameters: BopFields,
    public readonly functionVar: BopVariable,
  ) {}
}

export type BopGenericFunctionWriter = (typeParameters: BopFields) => BopVariable;

export class BopGenericFunction {
  readonly instantiations = new Map<string, BopGenericFunctionInstance>();

  constructor(
    public readonly instanceWriter: BopGenericFunctionWriter,
  ) {}
}

export class BopPropertyAccessor {
  constructor(
    public readonly getter: BopVariable,
    public readonly setter: BopVariable,
  ) {}
}

export class BopVariable {
  result?: CodeVariable;
  typeResult?: BopType;
  genericFunctionResult?: BopGenericFunction;
  propertyResult?: BopPropertyAccessor;

  constructor(
    public readonly nameHint: string,
    public readonly type: CodeTypeSpec,
    public readonly bopType: BopType,
    public group: BopVariableGroup,
  ) {}
}

export class BopVariableGroup {
  public readonly vars: BopVariable[] = [];

  constructor(
    public block: BopBlock,
  ) {}
}

export class BopBlock {
  readonly children: Array<BopStage|BopBlock> = [];
  readonly identifierMap = new Map<string, BopVariable>();
  thisRef?: BopVariable;
  functionOfConcreteImpl?: BopFunctionConcreteImplDetail;

  private constructor(
    public readonly scopeType: CodeScopeType,
    public readonly parent: BopBlock|undefined,
  ) {}

  createChildBlock(scopeType: CodeScopeType) {
    const newBlock = new BopBlock(scopeType, this);
    this.children.push(newBlock);
    return newBlock;
  }

  createTempBlock(scopeType: CodeScopeType) {
    const newBlock = new BopBlock(scopeType, this);
    return newBlock;
  }

  static createGlobalBlock() {
    return new BopBlock(CodeScopeType.Global, undefined);
  }

  mapStorageIdentifier(identifier: string, bopType: BopType, anonymous = false): BopVariable {
    return this.mapIdentifier(identifier, bopType.storageType, bopType, anonymous);
  }

  mapTempIdentifier(identifier: string, bopType: BopType, anonymous = false): BopVariable {
    return this.mapIdentifier(identifier, bopType.tempType, bopType, anonymous);
  }

  mapIdentifier(identifier: string, type: CodeTypeSpec, bopType: BopType, anonymous = false): BopVariable {
    const newGroup = new BopVariableGroup(this);
    const newVar = new BopVariable(identifier, type, bopType, newGroup);
    newGroup.vars.push(newVar);
    if (!anonymous) {
      this.identifierMap.set(identifier, newVar);
    }
    return newVar;
  }
}

export enum BopIdentifierPrefix {
  Function = 'F',
  Method = 'M',
  Constructor = 'ctor',
  Field = 'f',
  Local = 'v',
  Struct = 's',
  Extern = 'extern',
}

export class BopReference {
  public resolvedRef?: BopVariable;

  constructor(
    public readonly identifier: string,
    public readonly block: BopBlock,
  ) {}
}
