import { BapStaticFunctionSignature } from "./bap-exports";
import { BapGenerateContext, BapSubtreeGenerator, BapTypeSpec } from "./bap-value";

export type BapFunctionSignatureGenerator = (context: BapGenerateContext, typeArgs: BapTypeSpec[]) => BapStaticFunctionSignature;

export class BapModuleExports {
  readonly functions: {
    identifier: string;
    isGeneric: boolean;
    signatureGenerator: BapFunctionSignatureGenerator;
    staticSignature?: BapStaticFunctionSignature;
    valueGenerator: BapSubtreeGenerator;
  }[] = [];

  addFunction(init: {
    identifier: string;
    isGeneric: boolean;
    signatureGenerator: BapFunctionSignatureGenerator;
    valueGenerator: BapSubtreeGenerator;
  }) {
    this.functions.push(init);
  }
}