export interface BapStaticFunctionSignature {
  identifier: string;
  isGeneric: boolean;
  parameters: BapStaticField[];
  returnType?: BapStaticType;
}

export type BapStaticType = {
  isLibType: false;
  identifier: string;
  isAnonymous: boolean;
  fields: BapStaticField[];
} | {
  isLibType: true;
  identifier: string;
  isAnonymous: boolean;
};

export interface BapStaticField {
  identifier: string;
  type: BapStaticType;
}

export interface BapDebugInEntry {
  readonly lineNumber: number;
  readonly isGpu: boolean;
  readonly defaultValue: number;
}
