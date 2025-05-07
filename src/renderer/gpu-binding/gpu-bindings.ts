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
export type GpuBinding = GpuFixedBinding | GpuArrayBinding;

/** Several fields combined into a single blittable struct. */
export interface GpuFixedBinding extends GpuBindingBase {
  type: 'fixed';
  byteLength: number;
  marshalStructCodeTypeSpec: CodeTypeSpec;
  marshal(dataVar: CodeVariable, bufferVars: BufferFiller, body: CodeStatementWriter): void;
  copyIntoUserVar(userVar: CodeVariable, body: CodeStatementWriter, dataVarGetter: (expr: CodeExpressionWriter) => void): void;
}
/** A buffer that must be bound as its own uniform. */
export interface GpuArrayBinding extends GpuBindingBase {
  type: 'array';
  userType: BapTypeSpec;
  marshalArrayCodeTypeSpec: CodeTypeSpec;
  marshal(dataVar: CodeVariable, body: CodeStatementWriter): { arrayVar: CodeVariable; };
}
export interface GpuBindingBase {
  nameHint: string;
  location: number;
  unmarshal(dataVar: CodeVariable, body: CodeStatementWriter, intoContext: BapPrototypeScope): void;
}
