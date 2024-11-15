import { BopVariable, BopBlock, BopGenericFunction } from "./bop-data";
import { GpuBindings } from "./bop-shader-binding";
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
  readonly gpuBindings?: GpuBindings;
  touchedByGpu = false;
  touchedByCpu = false;

  constructor(
    public readonly bopVar: BopVariable,
    aux?: {
      gpuBindings?: GpuBindings;
    },
  ) {
    this.gpuBindings = aux?.gpuBindings;
  }
}

export class BopFunctionOf {
  public constructor(readonly overloads: BopFunctionType[]) {}
}

export class BopFunctionType {
  public concreteImpl?: BopFunctionConcreteImplDetail;

  public constructor(
    public readonly args: BopFields,
    public readonly returnType: BopType,
    public readonly isMethod: boolean,
    public readonly overloadIndex: number,
  ) {}
}

export class BopStructType {
  public marshalFunc?: CodeVariable;
  public marshalLength?: number;

  public constructor(
    readonly fields: BopVariable[]
  ) {}
}

export class BopInternalType {
  public constructor(readonly arrayOfType: BopType|undefined) {
  }
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
    public readonly structOf: BopStructType|undefined,
    public readonly functionOf: BopFunctionOf|undefined,
    public readonly unionOf: BopTypeUnion|undefined,
    public readonly internalTypeOf: BopInternalType|undefined,
  ) {}

  static createPassByRef(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
    structOf?: BopStructType,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType.toReference(),
      options.valueType.toReference(),
      true,
      options.innerScope,
      options.innerBlock,
      options.structOf,
      undefined,
      undefined,
      undefined,
    );
  }

  static createPassByValue(options: {
    debugName: string,
    valueType: CodeTypeSpec,
    innerScope: CodeScope,
    innerBlock: BopBlock,
    structOf?: BopStructType|undefined,
    internalTypeOf?: BopInternalType|undefined,
  }): BopType {
    return new BopType(
      options.debugName,
      options.valueType,
      options.valueType,
      options.valueType.toReference(),
      false,
      options.innerScope,
      options.innerBlock,
      options.structOf,
      undefined,
      undefined,
      options.internalTypeOf,
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
      undefined,
      options.unionOf,
      undefined,
    );
  }

  static createFunctionType(options: {
    debugName: string,
    innerScope: CodeScope,
    innerBlock: BopBlock,
    functionOf: BopFunctionOf,
  }): BopType {
    return new BopType(
      options.debugName,
      CodeTypeSpec.functionType,
      CodeTypeSpec.functionType,
      CodeTypeSpec.functionType,
      false,
      options.innerScope,
      options.innerBlock,
      undefined,
      options.functionOf,
      undefined,
      undefined,
    );
  }
}

export type BopFields = Array<{ type: BopType, identifier: string }>;

export interface BopInternalTypeBuilder {
  type: BopType;
  declareField(identifier: string, type: BopType): BopVariable;
  declareConstructor(params: BopFields): CodeFunctionWriter;
  declareMethod(identifier: string, params: BopFields, returnType: BopType): CodeFunctionWriter;
  declareInternalField(identifier: string, type: BopType): void;
  declareInternalConstructor(params: BopFields, internalIdentifier: string): void;
  declareInternalMethod(identifier: string, internalIdentifier: string, params: BopFields, returnType: BopType, options: { isMethod: boolean }): void;
  declareGenericMethod(identifier: string, genericFunc: BopGenericFunction): void;
  declareInternalProperty(identifier: string, type: BopType): BopVariable;
}

