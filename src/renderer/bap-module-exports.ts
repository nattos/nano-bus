import { BapStaticFunctionSignature } from "./bap-exports";
import { BapGenerateContext, BapTypeSpec } from "./bap-value";

export type BapFunctionSignatureGenerator = (context: BapGenerateContext, typeArgs: BapTypeSpec[]) => BapStaticFunctionSignature;

export class BapModuleExports {
  readonly functions: {
    identifier: string;
    isGeneric: boolean;
    signatureGenerator: BapFunctionSignatureGenerator;
    staticSignature?: BapStaticFunctionSignature;
  }[] = [];

  addFunction(init: {
    identifier: string;
    isGeneric: boolean;
    signatureGenerator: BapFunctionSignatureGenerator;
  }) {
    this.functions.push(init);
  }
}