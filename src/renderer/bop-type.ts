import { BopVariable, BopBlock, BopGenericFunction } from "./bop-data";
import { CodeVariable, CodeTypeSpec, CodeScope, CodeFunctionWriter } from "./code-writer";

export class BopTypeUnion {
  public constructor(
    caseVarsMap: Map<BopType, { caseVar: CodeVariable, caseIndex: number }>,
    caseVariable: CodeVariable,
  ) {}
}

export class BopFunctionConcreteImplDetail {
  readonly referencedFrom = new Set<BopFunctionConcreteImplDetail>;
  readonly references = new Set<BopFunctionConcreteImplDetail>;
  touchedByGpu = false;
  touchedByCpu = false;

  constructor(
    public readonly bopVar: BopVariable,
  ) {}
}

export class BopFunctionType {
  public concreteImpl?: BopFunctionConcreteImplDetail;

  public constructor(
    public readonly args: BopFields,
    public readonly returnType: BopType,
    public readonly isMethod: boolean,
  ) {}
}

export class BopType {
  private constructor(
    public readonly debugName: string,
    public readonly storageType: CodeTypeSpec,
    public readonly tempType: CodeTypeSpec,
    public readonly assignableRefType: CodeTypeSpec,
    public readonly passByRef: boolean,
    public readonly innerScope: CodeScope,
    public readonly innerBlock: BopBlock,
    public readonly functionOf: BopFunctionType|undefined,
    public readonly unionOf: BopTypeUnion|undefined,
  ) {}

  static createPassByRef(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType.toReference(),
      options.valueType.toReference(),
      true,
      options.innerScope,
      options.innerBlock,
      undefined,
      undefined,
    );
  }

  static createPassByValue(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType,
      options.valueType.toReference(),
      false,
      options.innerScope,
      options.innerBlock,
      undefined,
      undefined,
    );
  }

  static createTypeUnion(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
    unionOf: BopTypeUnion,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType,
      options.valueType.toReference(),
      false,
      options.innerScope,
      options.innerBlock,
      undefined,
      options.unionOf,
    );
  }

  static createFunctionType(options: {
    debugName: string,
    innerScope: CodeScope,
    innerBlock: BopBlock,
    functionOf: BopFunctionType,
  }): BopType {
    return new BopType(
      options.debugName,
      CodeTypeSpec.functionType,
      CodeTypeSpec.functionType,
      CodeTypeSpec.functionType,
      false,
      options.innerScope,
      options.innerBlock,
      options.functionOf,
      undefined,
    );
  }
}

export type BopFields = Array<{ type: BopType, identifier: string }>;

export type BopInternalTypeBuilder = {
  type: BopType,
  declareField(identifier: string, type: BopType): BopVariable,
  declareConstructor(params: BopFields): CodeFunctionWriter,
  declareMethod(identifier: string, params: BopFields, returnType: BopType): CodeFunctionWriter,
  declareInternalField(identifier: string, type: BopType): void,
  declareInternalConstructor(params: BopFields, internalIdentifier: string): void,
  declareInternalMethod(identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType): void,
  declareGenericMethod(identifier: string, genericFunc: BopGenericFunction): void,
  declareInternalProperty(identifier: string, type: BopType): BopVariable,
};

