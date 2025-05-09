import { BapPrototypeScope } from '../bap-scope';
import { BapTypeSpec } from '../bap-value';
import { CodeVariable, CodeStatementWriter, CodeTypeSpec, CodeExpressionWriter } from '../code-writer/code-writer';
import { BufferFiller } from './buffer-filler';


/**
 * Several shader uniforms, and how to marshal and unmarshal to and from device memory.
 */
export interface GpuBindings {
  bindings: GpuBinding[];
}

/** Data that translates to shader uniforms. */
export type GpuBinding = GpuFixedBinding | GpuArrayBinding | GpuTextureBinding;

/** Several fields combined into a single blittable struct. */
export interface GpuFixedBinding extends GpuBindingBase {
  type: 'fixed';
  byteLength: number;
  marshalStructCodeTypeSpec: CodeTypeSpec;
  marshal(dataVar: CodeVariable, bufferVars: BufferFiller, body: CodeStatementWriter): void;
  copyIntoUserVar(userVar: CodeVariable, body: CodeStatementWriter, dataVarGetter: (expr: CodeExpressionWriter) => void): void;
  copyIntoDataVar(userValueGetter: (expr: CodeExpressionWriter) => void, body: CodeStatementWriter, dataVarSetter: (block: CodeStatementWriter) => CodeExpressionWriter): void;
  unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void;
}
/** A buffer that must be bound as its own uniform. */
export interface GpuArrayBinding extends GpuBindingBase {
  type: 'array';
  userType: BapTypeSpec;
  marshalArrayCodeTypeSpec: CodeTypeSpec;
  marshal(dataVar: CodeVariable, body: CodeStatementWriter): { arrayVar: CodeVariable; };
  unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void;
}
/** A texture uniform along with a sampler. */
export interface GpuTextureBinding extends GpuBindingBase {
  type: 'texture';
  marshal(dataVar: CodeVariable, body: CodeStatementWriter): { textureVar: CodeVariable; samplerVar: CodeVariable; };
  unmarshal(textureDataVar: CodeVariable, samplerDataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void;
}
export interface GpuBindingBase {
  nameHint: string;
  location: number;
  writeIntoInitFunc?(body: CodeStatementWriter): void;
}
