import * as utils from '../../utils';

const TRACE = true;
const TRACE_IN_CODE = false;
const DEBUG = true;
const STRICT = false;

export enum CodeWriterPlatform {
  Metal = 'metal',
  WebGPU = 'web',
}

export enum CodePrimitiveType {
  Void = 'void',
  Type = 'type',
  Function = 'function',
  Bool = 'bool',
  Int = 'int32_t',
  CompileError = 'CompileError',
}

const WEBGPU_GPU_RENAMES: Record<string, string> = {
  'BopLib::int': 'i32',
  'int32_t': 'i32',
  'BopLib::int2': 'vec2i',
  'BopLib::int3': 'vec3i',
  'BopLib::int4': 'vec4i',
  'BopLib::uint': 'u32',
  'BopLib::uint3': 'vec3u',
  'BopLib::float': 'f32',
  'BopLib::float2': 'vec2f',
  'BopLib::float3': 'vec3f',
  'BopLib::float4': 'vec4f',
  'BopLib::Texture': 'texture_2d<f32>',
  'BopLib::TextureSampler': 'sampler',
  'Array': 'array',
  'BopLib::Array': 'array',
};

const WEBGPU_CPU_RENAMES: Record<string, string> = {
  'int32_t': 'BopLib.int',
  'Array': 'BopArray',
  'Texture': 'BopTexture',
};

export class CodeTypeSpec {
  public static readonly voidType = CodeTypeSpec.fromPrimitive(CodePrimitiveType.Void);
  public static readonly typeType = CodeTypeSpec.fromPrimitive(CodePrimitiveType.Type);
  public static readonly functionType = CodeTypeSpec.fromPrimitive(CodePrimitiveType.Function);
  public static readonly boolType = CodeTypeSpec.fromPrimitive(CodePrimitiveType.Bool);
  public static readonly intType = CodeTypeSpec.fromPrimitive(CodePrimitiveType.Int);
  public static readonly compileErrorType = CodeTypeSpec.fromPrimitive(CodePrimitiveType.CompileError);

  private constructor(
    public asStruct?: CodeNamedToken,
    public asPrimitive?: CodePrimitiveType,
    public typeArgs: CodeTypeSpec[] = [],
    public isReference: boolean = false,
    public isPointer: boolean = false,
    public isConst: boolean = false,
    public isArray: boolean = false,
  ) {}

  toCopy() {
    return new CodeTypeSpec(
      this.asStruct,
      this.asPrimitive,
      this.typeArgs,
      this.isReference,
      this.isPointer,
      this.isConst,
      this.isArray,
    );
  }

  toReference(value: boolean = true) { const copy = this.toCopy(); copy.isReference = value; return copy; }
  toConst(value: boolean = true) { const copy = this.toCopy(); copy.isConst = value; return copy; }
  toArray(value: boolean = true) { const copy = this.toCopy(); copy.isArray = value; return copy; }
  withTypeArgs(typeArgs: CodeTypeSpec[]) { const copy = this.toCopy(); copy.typeArgs = typeArgs; return copy; }

  static fromStruct(structIdentifier: CodeNamedToken) {
    return new CodeTypeSpec(structIdentifier, undefined);
  }

  static fromPrimitive(primitive: CodePrimitiveType) {
    return new CodeTypeSpec(undefined, primitive);
  }
}



export class CodeVariable {
  readonly identifierToken: CodeNamedToken;

  constructor(
    readonly typeSpec: CodeTypeSpec,
    nameHint: string,
    readonly group: CodeVariableGroup,
    options?: {
      fixedIdentifierToken?: CodeNamedToken;
    },
  ) {
    this.identifierToken = options?.fixedIdentifierToken ?? new CodeNamedToken(nameHint);
  }
}

export class CodeVariableGroup {
  readonly vars: CodeVariable[] = [];

  constructor(
    public scope: CodeScope,
  ) {}
}

export enum CodeScopeType {
  Global = 'global',
  Class = 'class',
  Function = 'function',
  Local = 'local',
}

export class CodeScope {
  readonly children: CodeScope[] = [];
  readonly groups: CodeVariableGroup[] = [];
  readonly identifiers: Array<{ identifier: CodeNamedToken, prefix: string }> = [];
  readonly referenceExprs: Array<{ identifier: CodeNamedToken, writerFunc: CodeWriterFunc }> = [];

  private constructor(readonly type: CodeScopeType, readonly parent: CodeScope|undefined) {}

  static createGlobalScope() {
    return new CodeScope(CodeScopeType.Global, undefined);
  }

  static createScope(type: CodeScopeType, parent: CodeScope) {
    const newScope = new CodeScope(type, parent);
    parent.children.push(newScope);
    return newScope;
  }

  createChildScope(type: CodeScopeType) {
    return CodeScope.createScope(type, this);
  }

  createVariableInScope(type: CodeTypeSpec, nameHint: string): CodeVariable {
    if (type.asPrimitive === CodePrimitiveType.CompileError) {
      console.log(type);
    }
    const newGroup = new CodeVariableGroup(this);
    this.groups.push(newGroup);
    const newVar = new CodeVariable(type, nameHint, newGroup);
    newGroup.vars.push(newVar);
    this.identifiers.push({
      identifier: newVar.identifierToken,
      prefix: 'v',
    });
    return newVar;
  }
  // createVariableLinkedLifetime(linkedVar: CodeVariable): CodeVariable {}

  allocateIdentifier(prefix: string, nameHint: string): CodeNamedToken {
    const identifier = new CodeNamedToken(nameHint);
    this.identifiers.push({
      identifier: identifier,
      prefix: prefix,
    });
    return identifier;
  }

  allocateVariableIdentifier(
    type: CodeTypeSpec,
    prefix: string,
    nameHint: string,
    options?: {
      fixedIdentifierToken?: CodeNamedToken;
    },
  ): CodeVariable {
    const newVar = new CodeVariable(type, nameHint, new CodeVariableGroup(this), options);
    const identifier = newVar.identifierToken;
    this.identifiers.push({
      identifier: identifier,
      prefix: prefix,
    });
    return newVar;
  }
}

export class CodeWriter {
  public readonly global = new CodeGlobalWriter();

  private readonly internalTokens = new Map<CodeNamedToken, string>();
  private readonly internalTokensInv = new Map<string, CodeNamedToken>();

  readonly errorToken = this.makeInternalToken('error');
  readonly underscoreToken = this.makeInternalToken('_');

  constructor() {
  }

  mapInternalToken(identifierToken: CodeNamedToken, internalIdentifier: string) {
    this.internalTokens.set(identifierToken, internalIdentifier);
    this.internalTokensInv.set(internalIdentifier, identifierToken);
  }

  makeInternalToken(internalIdentifier: string) {
    let identifierToken = this.internalTokensInv.get(internalIdentifier);
    if (!identifierToken) {
      identifierToken = this.global.scope.allocateIdentifier('internal', internalIdentifier);
      this.mapInternalToken(identifierToken, internalIdentifier);
    }
    return identifierToken;
  }

  getOuterCode(isGpu: boolean, platform: CodeWriterPlatform, options?: { translateTokens?: CodeNamedToken[] }): { code: string, translatedTokens: Map<CodeNamedToken, string> } {
    const identifierMap = new Map<CodeNamedToken, string>();
    const assignIdentifiersRec = (scope: CodeScope, depth: number) => {
      let depthStr: string;
      if (depth <= 3) {
        depthStr = ''.padEnd(depth, '_');
      } else {
        depthStr = `_${depth}_`;
      }

      let nextVarIndex = 0;
      for (const group of scope.groups) {
        for (const v of group.vars) {
          const identifier =
              this.internalTokens.get(v.identifierToken) ??
              `v${depthStr}${nextVarIndex}_${this.sanitizeIdentifier(v.identifierToken.nameHint)}`;
          identifierMap.set(v.identifierToken, identifier);
          nextVarIndex += 1;
        }
      }
      const prefixCounts = new Map<string, number>();
      for (const entry of scope.identifiers) {
        let nextIndex = prefixCounts.get(entry.prefix);
        if (nextIndex === undefined) {
          nextIndex = 0;
        }
        const identifier =
            this.internalTokens.get(entry.identifier) ??
            `${entry.prefix}${depthStr}${nextIndex}_${this.sanitizeIdentifier(entry.identifier.nameHint)}`;
        identifierMap.set(entry.identifier, identifier);
        prefixCounts.set(entry.prefix, nextIndex + 1);
      }

      for (const childScope of scope.children) {
        assignIdentifiersRec(childScope, depth + 1);
      }
    }
    assignIdentifiersRec(this.global.scope, 0);

    const context: CodeWriterContext = { isGpu: isGpu, platform: platform };
    const stream = new CodeTextStream(context, identifierMap);
    this.global.writerFunc(stream, context);
    const outerCode = stream.getOuterCode();

    const translatedTokens = new Map<CodeNamedToken, string>();
    if (options?.translateTokens) {
      for (const token of options.translateTokens) {
        const translated = identifierMap.get(token);
        if (translated) {
          translatedTokens.set(token, translated);
        }
      }
    }

    return {
      code: outerCode,
      translatedTokens: translatedTokens,
    };
  }

  sanitizeIdentifier(str: string): string {
    return str.replaceAll(/[^a-zA-Z0-9]/g, '_');
  }
}

type CodeWriterFunc = (stream: CodeTextStream, context: CodeWriterContext) => void;
function makeInvokeCodeWriterFuncHelper(stream: CodeTextStream, context: CodeWriterContext) {
  return (func: CodeWriterFunc) => func(stream, context);
}

interface CodeWriterFragment {
  get writerFunc(): CodeWriterFunc;
}

interface CodeWriterContext {
  isGpu: boolean;
  platform: CodeWriterPlatform;
}

export interface CodeFunctionWriter {
  body: CodeStatementWriter;
  returnTypeSpec: CodeTypeSpec;
  touchedByGpu: boolean;
  touchedByCpu: boolean;
  touchedByProxy?: {
    get touchedByGpu(): boolean;
    get touchedByCpu(): boolean;
  };
  addAttribute(attrib: CodeAttributeDecl): void;
  addReturnAttribute(attrib: CodeAttributeDecl): void;
  addParam(typeSpec: CodeTypeSpec, identifier: CodeNamedToken, options?: { attribs?: CodeAttributeDecl[] }): void;
}

export class CodeGlobalWriter implements CodeWriterFragment {
  public readonly scope: CodeScope = CodeScope.createGlobalScope();

  private typedefWriters: CodeWriterFunc[] = [];
  private typeWriters: CodeWriterFunc[] = [];
  private globalStatementWriters: CodeWriterFunc[] = [];
  private typeIdentifiers: CodeNamedToken[] = [];
  private functionWriters: CodeWriterFunc[] = [];

  get writerFunc(): CodeWriterFunc {
    return (stream, context) => {
      this.typedefWriters.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
      this.typeWriters.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
      this.globalStatementWriters.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
      this.functionWriters.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
    };
  }

  writeVariableDeclaration(thisVar: CodeVariable) {
    const statementScope = this.scope.createChildScope(CodeScopeType.Local);
    const statement = new CodeStatementWriter(statementScope);
    this.globalStatementWriters.push((stream, context) => statement.writerFunc(stream, context));
    return statement.writeVariableDeclaration(thisVar);
  }

  writeFunction(identifier: CodeNamedToken): CodeFunctionWriter {
    const functionScope = this.scope.createChildScope(CodeScopeType.Function);
    const attribs: CodeAttributeDecl[] = [];
    const returnAttribs: CodeAttributeDecl[] = [];
    const params: Array<{ typeSpec: CodeTypeSpec, identifier: CodeNamedToken, options?: { attribs?: CodeAttributeDecl[] } }> = [];
    const result: CodeFunctionWriter = {
      body: new CodeStatementWriter(functionScope),
      returnTypeSpec: CodeTypeSpec.voidType,
      touchedByCpu: false,
      touchedByGpu: false,
      touchedByProxy: undefined,
      addAttribute(attrib: CodeAttributeDecl): void {
        attribs.push(attrib);
      },
      addReturnAttribute(attrib: CodeAttributeDecl): void {
        returnAttribs.push(attrib);
      },
      addParam(typeSpec: CodeTypeSpec, identifier: CodeNamedToken, options?: { attribs?: CodeAttributeDecl[] }) {
        params.push({ typeSpec, identifier, options });
      },
    };
    this.functionWriters.push((stream, context) => {
      if (context.isGpu) {
        if (!(result.touchedByProxy?.touchedByGpu ?? result.touchedByGpu)) {
          return;
        }
      } else {
        if (!(result.touchedByProxy?.touchedByCpu ?? result.touchedByCpu)) {
          return;
        }
      }
      writeAttribs(stream, context, attribs, { multiLine: true });
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken('fn');
      } else if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        stream.writeToken('function');
      } else {
        stream.writeTypeSpec(result.returnTypeSpec);
      }
      stream.writeWhitespace();
      stream.writeToken(identifier);
      stream.writeToken('(');

      let isFirstParam = true;
      for (const param of params) {
        if (isFirstParam) {
          isFirstParam = false;
        } else {
          stream.writeToken(',');
        }
        stream.writeWhitespacePadding();
        writeAttribs(stream, context, param.options?.attribs);
        stream.writeWhitespacePadding();
        if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
          stream.writeToken(param.identifier);
          stream.writeToken(':');
          stream.writeWhitespace();
          stream.writeTypeSpec(param.typeSpec);
        } else if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
          stream.writeToken(param.identifier);
        } else {
          stream.writeTypeSpec(param.typeSpec);
          stream.writeWhitespace();
          stream.writeToken(param.identifier);
        }
      }

      stream.writeToken(')');
      stream.writeWhitespace();
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        if (result.returnTypeSpec.asPrimitive !== CodePrimitiveType.Void) {
          stream.writeToken('->');
          stream.writeWhitespace();
          writeAttribs(stream, context, returnAttribs);
          stream.writeTypeSpec(result.returnTypeSpec);
          stream.writeWhitespacePadding();
        }
      }
      stream.writeToken('{');
      stream.flushLine();
      stream.indent();
      result.body.writerFunc(stream, context);
      stream.flushLine();
      stream.unindent();
      stream.writeToken('}');
      stream.flushLine();
    });
    return result;
  }

  writeStruct(identifier: CodeNamedToken): CodeStructWriter {
    const result: CodeStructWriter = {
      body: new CodeStructBodyWriter(this.scope.createChildScope(CodeScopeType.Class)),
      touchedByGpu: true,
      touchedByCpu: true,
      touchedByProxy: undefined,
      isInternalOnly: false,
    };
    this.typeIdentifiers.push(identifier);
    this.typeWriters.push((stream, context) => {
      if (context.isGpu) {
        if (!(result.touchedByProxy?.touchedByGpu ?? result.touchedByGpu)) {
          return;
        }
      } else {
        if (!(result.touchedByProxy?.touchedByCpu ?? result.touchedByCpu)) {
          return;
        }
      }
      if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        // JavaScript fun.
        stream.writeToken('class');
        stream.writeWhitespace();
        stream.writeToken(identifier);
        stream.writeWhitespace();
        stream.writeToken('{');
        stream.flushLine();
        stream.indent();
        stream.writeToken('static');
        stream.writeWhitespace();
        stream.writeToken('cast');
        stream.writeToken('(');
        stream.writeToken('x');
        stream.writeToken(')');
        stream.writeWhitespace();
        stream.writeToken('{');
        stream.writeWhitespace();
        stream.writeToken('return');
        stream.writeWhitespace();
        stream.writeToken('x');
        stream.writeToken(';');
        stream.writeWhitespace();
        stream.writeToken('}');
        stream.flushLine();

        if (result.body.hasStaticConstants) {
          result.body.staticConstantsWriterFunc(stream, context);
        }

        if (result.touchedByGpu) {
          stream.writeToken('static');
          stream.writeWhitespace();
          stream.writeToken('fields');
          stream.writeWhitespace();
          stream.writeToken('=');
          stream.writeWhitespace();
          stream.writeToken('{');
          stream.flushLine();
          stream.indent();
          for (const { identifier: fieldIdentifier, typeSpec: fieldTypeSpec } of result.body.fields) {
            stream.writeToken(CodeExpressionWriter.formatLiteralStringToken(stream.translateToken(fieldIdentifier), context));
            stream.writeToken(':');
            stream.writeWhitespace();
            stream.writeTypeSpec(fieldTypeSpec);
            stream.writeToken(',');
            stream.flushLine();
          }
          stream.unindent();
          stream.writeToken('}');
          stream.flushLine();
        }

        stream.writeToken('constructor');
        stream.writeToken('(');
        for (const { identifier: fieldIdentifier, typeSpec: fieldTypeSpec } of result.body.fields) {
          stream.writeToken(fieldIdentifier);
          stream.writeToken(',');
          stream.writeWhitespace();
        }
        stream.writeToken(')');
        stream.writeWhitespace();
        stream.writeToken('{');
        stream.flushLine();
        stream.indent();
        for (const { identifier: fieldIdentifier, typeSpec: fieldTypeSpec } of result.body.fields) {
          stream.flushLine();
          stream.writeToken('this');
          stream.writeToken('.');
          stream.writeToken(fieldIdentifier);
          stream.writeWhitespace();
          stream.writeToken('=');
          stream.writeWhitespace();
          stream.writeToken(fieldIdentifier);
          if (!result.isInternalOnly) {
            stream.writeWhitespace();
            stream.writeToken('??');
            stream.writeWhitespace();
            stream.writeTypeSpec(fieldTypeSpec);
            stream.writeToken('.');
            stream.writeToken('constructor');
            stream.writeToken('(');
            stream.writeToken(')');
          }
          stream.writeToken(';');
          stream.flushLine();
        }
        stream.unindent();
        stream.writeToken('}');
        stream.flushLine();

        stream.unindent();
        stream.writeToken('}');
        stream.flushLine();
        return;
      }
      stream.writeToken('struct');
      stream.writeWhitespace();
      stream.writeToken(identifier);
      stream.writeWhitespace();
      stream.writeToken('{');
      stream.flushLine();
      stream.indent();
      result.body.writerFunc(stream, context);
      stream.flushLine();
      stream.unindent();
      stream.writeToken('};');
      stream.flushLine();
    });
    return result;
  }

  writeTypedef(identifier: CodeNamedToken, type: CodeTypeSpec): CodeTypedefWriter {
    const result: CodeTypedefWriter = {
      touchedByGpu: true,
      touchedByCpu: true,
      touchedByProxy: undefined,
    };
    const trace = getTrace();
    this.typeIdentifiers.push(identifier);
    this.typedefWriters.push((stream, context) => {
      if (context.isGpu) {
        if (!(result.touchedByProxy?.touchedByGpu ?? result.touchedByGpu)) {
          return;
        }
      } else {
        if (!(result.touchedByProxy?.touchedByCpu ?? result.touchedByCpu)) {
          return;
        }
      }
      if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        // JavaScript fun.
        stream.writeToken('const');
        stream.writeWhitespace();
        stream.writeToken(identifier);
        stream.writeWhitespace();
        stream.writeToken('=');
        stream.writeWhitespace();
        stream.writeTypeSpec(type);
        stream.writeToken(';');
      } else if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken('alias');
        stream.writeWhitespace();
        stream.writeToken(identifier);
        stream.writeWhitespace();
        stream.writeToken('=');
        stream.writeWhitespace();
        stream.writeTypeSpec(type);
        stream.writeToken(';');
      } else {
        stream.writeToken('typedef');
        stream.writeWhitespace();
        stream.writeTypeSpec(type);
        stream.writeWhitespace();
        stream.writeToken(identifier);
        stream.writeToken(';');
      }
      if (TRACE_IN_CODE && trace) {
        stream.writeWhitespacePadding();
        stream.writeBlockComment(trace);
      }
      stream.flushLine();
    });
    return result;
  }
}

export interface CodeStructWriter {
  body: CodeStructBodyWriter;
  touchedByGpu: boolean;
  touchedByCpu: boolean;
  touchedByProxy?: {
    get touchedByGpu(): boolean;
    get touchedByCpu(): boolean;
  };
  isInternalOnly: boolean;
}

export interface CodeTypedefWriter {
  touchedByGpu: boolean;
  touchedByCpu: boolean;
  touchedByProxy?: {
    get touchedByGpu(): boolean;
    get touchedByCpu(): boolean;
  };
}

export enum CodeAttributeKey {
  GpuVarUniform = 'GpuVarUniform',
  GpuVarReadWriteArray = 'GpuVarReadWriteArray',
  GpuFunctionCompute = 'GpuFunctionCompute',
  GpuFunctionVertex = 'GpuFunctionVertex',
  GpuFunctionFragment = 'GpuFunctionFragment',
  GpuVertexAttributePosition = 'GpuVertexAttributePosition',
  GpuBindLocation = 'GpuBindLocation',
  GpuBindingLocation = 'GpuBindingLocation',
  GpuVertexBindingLocation = 'GpuVertexBindingLocation',
  GpuFragmentBindingLocation = 'GpuFragmentBindingLocation',
  GpuComputeBindingLocation = 'GpuComputeBindingLocation',
  GpuBindVertexIndex = 'GpuBindVertexIndex',
  GpuBindThreadIndex = 'GpuBindThreadIndex',
  GpuWorkgroupSize = 'GpuWorkgroupSize',
}

function hasAttrib(attribs: Array<CodeAttributeDecl>|undefined, key: CodeAttributeKey): boolean {
  if (!attribs) {
    return false;
  }
  for (const attrib of attribs) {
    if (attrib.key === key) {
      return true;
    }
  }
  return false;
}

function writeAttribs(stream: CodeTextStream, context: CodeWriterContext, attribs: Array<CodeAttributeDecl>|undefined, options?: { multiLine?: boolean }) {
  if (!attribs) {
    return;
  }
  const writeWhitespace = () => {
    if (options?.multiLine) {
      stream.flushLine();
    } else {
      stream.writeWhitespace();
    }
  };
  if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
    for (const attrib of attribs) {
      if (attrib.key === CodeAttributeKey.GpuFunctionCompute) {
        stream.writeToken('@');
        stream.writeToken('compute');
        writeWhitespace();
      } else if (attrib.key === CodeAttributeKey.GpuFunctionVertex) {
        stream.writeToken('@');
        stream.writeToken('vertex');
        writeWhitespace();
      } else if (attrib.key === CodeAttributeKey.GpuFunctionFragment) {
        stream.writeToken('@');
        stream.writeToken('fragment');
        writeWhitespace();
      } else if (attrib.key === CodeAttributeKey.GpuVertexAttributePosition) {
        stream.writeToken('@');
        stream.writeToken('builtin');
        stream.writeToken('(');
        stream.writeToken('position');
        stream.writeToken(')');
        writeWhitespace();
      } else if (attrib.key === CodeAttributeKey.GpuBindLocation && attrib.intValue !== undefined) {
        stream.writeToken('@');
        stream.writeToken('location');
        stream.writeToken('(');
        stream.writeToken(CodeExpressionWriter.formatLiteralIntToken(attrib.intValue));
        stream.writeToken(')');
        writeWhitespace();
      } else if ((
          attrib.key === CodeAttributeKey.GpuBindingLocation ||
          attrib.key === CodeAttributeKey.GpuFragmentBindingLocation ||
          attrib.key === CodeAttributeKey.GpuVertexBindingLocation ||
          attrib.key === CodeAttributeKey.GpuComputeBindingLocation) && attrib.intValue !== undefined) {
        const groupIndex = attrib.key === CodeAttributeKey.GpuFragmentBindingLocation ? 1 : 0;
        stream.writeToken('@');
        stream.writeToken('group');
        stream.writeToken('(');
        stream.writeToken(CodeExpressionWriter.formatLiteralIntToken(groupIndex));
        stream.writeToken(')');
        writeWhitespace();
        stream.writeToken('@');
        stream.writeToken('binding');
        stream.writeToken('(');
        stream.writeToken(CodeExpressionWriter.formatLiteralIntToken(attrib.intValue));
        stream.writeToken(')');
        writeWhitespace();
      } else if (attrib.key === CodeAttributeKey.GpuBindVertexIndex) {
        stream.writeToken('@');
        stream.writeToken('builtin');
        stream.writeToken('(');
        stream.writeToken('vertex_index');
        stream.writeToken(')');
        writeWhitespace();
      } else if (attrib.key === CodeAttributeKey.GpuBindThreadIndex) {
        stream.writeToken('@');
        stream.writeToken('builtin');
        stream.writeToken('(');
        stream.writeToken('global_invocation_id');
        stream.writeToken(')');
        writeWhitespace();
      } else if (attrib.key === CodeAttributeKey.GpuWorkgroupSize && attrib.intValue !== undefined) {
        stream.writeToken('@');
        stream.writeToken('workgroup_size');
        stream.writeToken('(');
        stream.writeToken(CodeExpressionWriter.formatLiteralIntToken(attrib.intValue));
        stream.writeToken(')');
        writeWhitespace();
      }
    }
  }
}

export interface CodeAttributeDecl {
  key: CodeAttributeKey;
  intValue?: number;
}

export class CodeStructBodyWriter implements CodeWriterFragment {
  private fieldWriterFuncs: CodeWriterFunc[] = [];
  private staticConstantsWriterFuncs: CodeWriterFunc[] = [];
  readonly fields: { identifier: CodeNamedToken, typeSpec: CodeTypeSpec }[] = [];
  readonly staticConstants: { identifier: CodeNamedToken, typeSpec: CodeTypeSpec, reference: CodeVariable }[] = [];

  get fieldCount() { return this.fieldWriterFuncs.length; }

  constructor(
    public readonly scope: CodeScope,
  ) {}

  get writerFunc(): CodeWriterFunc {
    return (stream, context) => {
      this.fieldWriterFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
    };
  }

  get hasStaticConstants() {
    return this.staticConstantsWriterFuncs.length > 0;
  }

  get staticConstantsWriterFunc(): CodeWriterFunc {
    return (stream, context) => {
      this.staticConstantsWriterFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
    };
  }

  writeField(
      identifier: CodeNamedToken,
      typeSpec: CodeTypeSpec,
      options?: {
        attribs?: CodeAttributeDecl[];
      },
  ) {
    this.fields.push({ identifier, typeSpec });
    this.fieldWriterFuncs.push((stream, context) => {
      writeAttribs(stream, context, options?.attribs);
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken(identifier);
        stream.writeToken(':');
        stream.writeWhitespace();
        stream.writeTypeSpec(typeSpec);
        stream.writeToken(',');
        stream.flushLine();
      } else {
        stream.writeTypeSpec(typeSpec);
        stream.writeWhitespace();
        stream.writeToken(identifier);
        stream.writeToken(';');
        stream.flushLine();
      }
    });
  }

  writeStaticConstant(
      identifier: CodeNamedToken,
      typeSpec: CodeTypeSpec,
      reference: CodeVariable|(() => CodeVariable|((expr: CodeExpressionWriter) => void)|undefined),
  ) {
    this.staticConstantsWriterFuncs.push((stream, context) => {
      let innerWriter: CodeWriterFunc|undefined;
      if (typeof reference === 'function') {
        const innerRef = reference();
        if (innerRef === undefined) {
          return;
        }
        if(typeof innerRef === 'function') {
          const innerExpr = new CodeExpressionWriter();
          innerRef(innerExpr);
          innerWriter = (stream, context) => {
            innerExpr.writerFunc(stream, context);
          };
        } else {
          innerWriter = (stream, context) => {
            stream.writeToken(innerRef.identifierToken);
          };
        }
      } else {
        innerWriter = (stream, context) => {
          stream.writeToken(reference.identifierToken);
        };
      }
      if (!innerWriter) {
        return;
      }
      if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        stream.writeToken('static');
        stream.writeWhitespace();
        stream.writeToken(identifier);
        stream.writeWhitespace();
        stream.writeToken('=');
        stream.writeWhitespace();
        innerWriter(stream, context);
        stream.writeToken(';');
        stream.flushLine();
      }
    });
  }
}

export class CodeStatementWriter implements CodeWriterFragment {
  private statementWriterFuncs: CodeWriterFunc[] = [];
  private didEarlyExit = false;

  get writerFunc(): CodeWriterFunc {
    return (stream, context) => {
      this.statementWriterFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
    };
  }

  constructor(
    public readonly scope: CodeScope,
    public readonly options?: { singleStatement?: boolean; expressionLike?: boolean; },
  ) {}

  private pushWriterFunc(writerFunc: CodeWriterFunc) {
    if (this.options?.singleStatement && this.statementWriterFuncs.length > 0) {
      throw new Error('Statement is already defined.');
    }
    if (this.didEarlyExit) {
      return;
    }
    this.statementWriterFuncs.push(writerFunc);
  }

  private writeFinalizeLine(stream: CodeTextStream, context: CodeWriterContext) {
    if (!this.options?.expressionLike) {
      stream.writeToken(';');
      stream.flushLine();
    }
  }

  writeEmptyStatement() {
    const writerFunc: CodeWriterFunc = (stream, context) => {
      this.writeFinalizeLine(stream, context);
    }
    this.pushWriterFunc(writerFunc);
  }

  writeVariableDeclaration(thisVar: CodeVariable): {
    initializer: CodeInitializerWriter,
    attribs: CodeAttributeDecl[],
  } {
    const result = {
      initializer: new CodeInitializerWriter(thisVar.typeSpec),
      attribs: [],
    };
    const isRef = thisVar.typeSpec.isReference;
    const writerFunc: CodeWriterFunc = (stream, context) => {
      writeAttribs(stream, context, result.attribs);
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        if (isRef) {
          return;
        }
        stream.writeToken('var');
        if (hasAttrib(result.attribs, CodeAttributeKey.GpuVarUniform)) {
          stream.writeToken('<');
          stream.writeToken('uniform');
          stream.writeToken('>');
        } else if (hasAttrib(result.attribs, CodeAttributeKey.GpuVarReadWriteArray)) {
          stream.writeToken('<');
          stream.writeToken('storage');
          stream.writeToken(',');
          stream.writeWhitespace();
          stream.writeToken('read_write');
          stream.writeToken('>');
        }
      } else if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        stream.writeToken('let');
      } else {
        stream.writeTypeSpec(thisVar.typeSpec);
      }
      stream.writeWhitespace();
      stream.writeToken(thisVar.identifierToken);
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken(':');
        stream.writeWhitespace();
        stream.writeTypeSpec(thisVar.typeSpec);
      } else if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        if (DEBUG) {
          stream.writeWhitespace();
          stream.writeBlockCommentBegin();
          stream.writeWhitespace();
          stream.writeTypeSpec(thisVar.typeSpec);
          stream.writeWhitespace();
          stream.writeBlockCommentEnd();
        }
      }
      if (result.initializer.isDefined) {
        stream.writeWhitespacePadding();
        stream.writeToken('=');
        stream.writeWhitespacePadding();
        result.initializer.writerFunc(stream, context);
      }
      this.writeFinalizeLine(stream, context);
    };
    const directAccessWriterFunc: CodeWriterFunc = (stream, context) => {
      result.initializer.writerFunc(stream, context);
    };
    this.pushWriterFunc(writerFunc);
    if (isRef) {
      this.scope.referenceExprs.push({ identifier: thisVar.identifierToken, writerFunc: directAccessWriterFunc });
    }
    return result;
  }
  writeAssignmentStatement(): { ref: CodeExpressionWriter, value: CodeExpressionWriter } {
    const result = {
      ref: new CodeExpressionWriter(),
      value: new CodeExpressionWriter(),
    };
    this.pushWriterFunc((stream, context) => {
      result.ref.writerFunc(stream, context);
      stream.writeWhitespacePadding();
      stream.writeToken('=');
      stream.writeWhitespacePadding();
      result.value.writerFunc(stream, context);
      this.writeFinalizeLine(stream, context);
    });
    return result;
  }
  writeExpressionStatement(): { expr: CodeExpressionWriter; } {
    const result = {
      expr: new CodeExpressionWriter({ isDiscardable: true }),
    };
    this.pushWriterFunc((stream, context) => {
      if (result.expr.isDiscarded) {
        return;
      }
      result.expr.writerFunc(stream, context);
      this.writeFinalizeLine(stream, context);
    });
    return result;
  }
  writeConditional(branchCount: number): { branches: CodeBranchWriter[] } {
    const branches = Array.from(utils.range(branchCount)).map(i => new CodeBranchWriter(new CodeExpressionWriter(), new CodeStatementWriter(this.scope.createChildScope(CodeScopeType.Local))));
    const result = {
      branches: branches,
    };
    this.pushWriterFunc((stream, context) => {
      for (let i = 0; i < branches.length; ++i) {
        const branch = branches[i];
        const branchHasCondition = branch.condWriter.isDefined;
        const isFirstBranch = i === 0;
        const isLastBranch = i === branches.length - 1;
        let conditionRequired = true;
        if (isFirstBranch) {
          stream.writeToken('if');
          stream.writeWhitespace();
        } else if (isLastBranch && !branchHasCondition) {
          conditionRequired = false;
          stream.writeWhitespacePadding();
          stream.writeToken('else');
          stream.writeWhitespace();
        } else {
          stream.writeWhitespacePadding();
          stream.writeToken('else if');
          stream.writeWhitespace();
        }
        if (conditionRequired && !branchHasCondition) {
          throw new Error('All branches except the last must have a condition.');
        }
        if (branchHasCondition) {
          stream.writeToken('(');
          stream.indent(2);
          branch.condWriter.writerFunc(stream, context);
          stream.unindent(2);
          stream.writeToken(')');
          stream.writeWhitespace();
        }
        stream.writeToken('{');
        stream.flushLine();
        stream.indent();
        branch.blockWriter.writerFunc(stream, context);
        stream.flushLine();
        stream.unindent();
        stream.writeToken('}');
      }
      stream.flushLine();
    });
    return result;
  }
  writeForLoop(): { initializer: CodeStatementWriter, condition: CodeExpressionWriter, updatePart: CodeStatementWriter, body: CodeStatementWriter } {
    const conditionStmt = new CodeStatementWriter(this.scope.createChildScope(CodeScopeType.Local), { singleStatement: true });
    const result = {
      initializer: new CodeStatementWriter(this.scope.createChildScope(CodeScopeType.Local), { singleStatement: true }),
      condition: conditionStmt.writeExpressionStatement().expr,
      updatePart: new CodeStatementWriter(this.scope.createChildScope(CodeScopeType.Local), { singleStatement: true, expressionLike: true }),
      body: new CodeStatementWriter(this.scope.createChildScope(CodeScopeType.Local)),
    };
    this.pushWriterFunc((stream, context) => {
      stream.writeToken('for');
      stream.writeWhitespace();
      stream.writeToken('(');
      result.initializer.writerFunc(stream, context);
      stream.flushLine();
      stream.indent(2);
      conditionStmt.writerFunc(stream, context);
      stream.flushLine();
      result.updatePart.writerFunc(stream, context);
      stream.writeToken(')');
      stream.writeWhitespace();
      stream.writeToken('{');
      stream.flushLine();
      stream.unindent(2);
      stream.indent();
      result.body.writerFunc(stream, context);
      stream.flushLine();
      stream.unindent();
      stream.writeToken('}');
      stream.flushLine();
    });
    return result;
  }
  writeWhileLoop(): { condition: CodeExpressionWriter, body: CodeStatementWriter } {
    const conditionStmt = new CodeExpressionWriter();
    const result = {
      condition: conditionStmt,
      body: new CodeStatementWriter(this.scope.createChildScope(CodeScopeType.Local)),
    };
    this.pushWriterFunc((stream, context) => {
      stream.writeToken('while');
      stream.writeWhitespace();
      stream.writeToken('(');
      conditionStmt.writerFunc(stream, context);
      stream.writeToken(')');
      stream.writeWhitespace();
      stream.writeToken('{');
      stream.flushLine();
      stream.indent();
      result.body.writerFunc(stream, context);
      stream.flushLine();
      stream.unindent();
      stream.writeToken('}');
      stream.flushLine();
    });
    return result;
  }
  writeReturnStatement(): { expr: CodeExpressionWriter } {
    const result = {
      expr: new CodeExpressionWriter(),
    };
    this.pushWriterFunc((stream, context) => {
      stream.writeToken('return');
      if (result.expr.isDefined) {
        stream.writeWhitespace();
        result.expr.writerFunc(stream, context);
      }
      this.writeFinalizeLine(stream, context);
    });
    this.didEarlyExit = true;
    return result;
  }
  writeBreakStatement() {
    this.pushWriterFunc((stream, context) => {
      stream.writeToken('break');
      this.writeFinalizeLine(stream, context);
    });
    this.didEarlyExit = true;
  }
  writeContinueStatement() {
    this.pushWriterFunc((stream, context) => {
      stream.writeToken('continue');
      this.writeFinalizeLine(stream, context);
    });
    this.didEarlyExit = true;
  }
}

export class CodeBranchWriter {
  constructor(
    public readonly condWriter: CodeExpressionWriter,
    public readonly blockWriter : CodeStatementWriter,
  ) {}
}

export enum CodeUnaryOperator {
  Plus = '+',
  Negate = '-',
  LogicalNot = '!',
  BitwiseNegate = '~',
}

export enum CodeBinaryOperator {
  Add = '+',
  Subtract = '-',
  Multiply = '*',
  Divide = '/',
  Power = '**',
  Modulo = '%',
  Equals = '==',
  NotEquals = '!=',
  GreaterThan = '>',
  GreaterThanEquals = '>=',
  LessThan = '<',
  LessThanEquals = '<=',
  LogicalOr = '||',
  LogicalAnd = '&&',
}

export class CodeExpressionWriterBase implements CodeWriterFragment {
  private writerFuncField?: CodeWriterFunc;

  get isDefined() { return this.writerFuncField !== undefined; }
  get isDiscarded() { return this._discarded; }
  get isDiscardable() { return this.init?.isDiscardable ?? false; }
  private _discarded = false;
  private readonly trace;

  constructor(private readonly init?: { isDiscardable?: boolean }) {
    this.trace = getTrace();
  }

  discard() {
    if (!this.isDiscardable) {
      throw new Error(`Expression is not discardable.${this.trace}`);
    }
    this._discarded = true;
  }

  get writerFunc(): CodeWriterFunc {
    if (!this.writerFuncField) {
      const error = new Error(`Expression is not yet defined.${this.trace}`);
      console.error(error);
      if (STRICT) {
        throw error;
      } else {
        return (stream, context) => { stream.writeToken('***error***'); };
      }
    }
    if (TRACE_IN_CODE && this.trace) {
      const inner = this.writerFuncField;
      return (stream, context) => {
        inner(stream, context);
        stream.writeWhitespacePadding();
        stream.writeBlockComment(this.trace);
      };
    }
    return this.writerFuncField;
  }

  protected setWriter(func: CodeWriterFunc) {
    if (this.writerFuncField) {
      throw new Error(`Expression is already defined.${this.trace}`);
    }
    this.writerFuncField = func;
  }

  protected setWriterFromFragment(fragment: CodeWriterFragment) {
    this.setWriter((stream, context) => fragment.writerFunc(stream, context));
  }
}

export class CodeInitializerWriter extends CodeExpressionWriterBase {
  private isStructInitializer?: boolean;
  private structFieldInitializerFuncs: CodeWriterFunc[] = [];

  constructor(public readonly typeSpec: CodeTypeSpec) {
    super();
  }

  writeExpression(): CodeExpressionWriter {
    const result = new CodeExpressionWriter();
    this.setWriterFromFragment(result);
    return result;
  }

  writeAssignStructField(fieldIdentifier: CodeNamedToken): { value: CodeExpressionWriter } {
    if (this.isStructInitializer === undefined) {
      this.setWriter((stream, context) => {
        if (context.platform === CodeWriterPlatform.WebGPU) {
          stream.writeWhitespacePadding();
          if (!context.isGpu) {
            stream.writeToken('new');
            stream.writeWhitespace();
          }
          stream.writeTypeSpec(this.typeSpec);
          stream.writeToken('(');
          if (this.structFieldInitializerFuncs.length == 1) {
            stream.writeWhitespace();
            this.structFieldInitializerFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
            stream.writeWhitespace();
          } else {
            stream.flushLine();
            stream.indent(2);
            for (const func of this.structFieldInitializerFuncs) {
              func(stream, context);
              stream.writeToken(',');
              stream.flushLine();
            }
            stream.unindent(2);
          }
          stream.writeToken(')');
        } else {
          stream.writeWhitespacePadding();
          stream.writeToken('{');
          if (this.structFieldInitializerFuncs.length == 1) {
            stream.writeWhitespace();
            this.structFieldInitializerFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream, context));
            stream.writeWhitespace();
          } else {
            stream.flushLine();
            stream.indent(2);
            for (const func of this.structFieldInitializerFuncs) {
              func(stream, context);
              stream.writeToken(',');
              stream.flushLine();
            }
            stream.unindent(2);
          }
          stream.writeToken('}');
        }
      });
      this.isStructInitializer = true;
    } else if (!this.isStructInitializer) {
      throw new Error('Cannot change an expression initializer into a struct initializer.');
    }
    const result = {
      value: new CodeExpressionWriter(),
    };
    this.structFieldInitializerFuncs.push((stream, context) => {
      if (context.platform === CodeWriterPlatform.WebGPU) {
        result.value.writerFunc(stream, context);
      } else {
        stream.writeToken('.');
        stream.writeToken(fieldIdentifier);
        stream.writeWhitespace();
        stream.writeToken('=');
        stream.writeWhitespace();
        result.value.writerFunc(stream, context);
      }
    });
    return result;
  }
}

export class CodeExpressionWriter extends CodeExpressionWriterBase {
  writeLiteralNullptr() { this.writeLiteralImpl('nullptr'); }
  writeLiteralBool(value: boolean) { this.writeLiteralImpl(value ? 'true' : 'false'); }
  static formatLiteralIntToken(value: number): string { return Math.round(value).toString(); }
  writeLiteralInt(value: number) { this.writeLiteralImpl(CodeExpressionWriter.formatLiteralIntToken(value)); }
  writeLiteralFloat(value: number) {
    this.setWriter((stream, context) => {
      let escaped = `${value.toString()}`;
      if (!(context.platform === CodeWriterPlatform.WebGPU && !context.isGpu)) {
        escaped = escaped + 'f';
      }

      stream.writeWhitespacePadding();
      stream.writeToken(escaped);
    });
  }
  writeLiteralDouble(value: number) { this.writeLiteralImpl(value.toString()); }
  static formatLiteralStringToken(value: string, context: CodeWriterContext, options?: { managed?: boolean }): string {
    let escaped = JSON.stringify(value);
    if (options?.managed && context.platform === CodeWriterPlatform.Metal) {
      escaped = '@' + escaped;
    }
    return escaped;
  }
  writeLiteralString(value: string, options?: { managed?: boolean }) {
    this.setWriter((stream, context) => {
      const escaped = CodeExpressionWriter.formatLiteralStringToken(value, context);
      stream.writeWhitespacePadding();
      stream.writeToken(escaped);
    });
  }
  private writeLiteralImpl(literal: string) {
    this.setWriter((stream, context) => {
      stream.writeWhitespacePadding();
      stream.writeToken(literal);
    });
  }

  writeIdentifier(token: CodeNamedToken) {
    this.setWriter(stream => {
      stream.writeWhitespacePadding();
      stream.writeToken(token);
    });
  }

  writeLiteralStringToken(token: CodeNamedToken, options?: { managed?: boolean }) {
    this.setWriter((stream, context) => {
      const value = stream.translateToken(token);
      let escaped = JSON.stringify(value);
      if (options?.managed && context.platform === CodeWriterPlatform.Metal) {
        escaped = '@' + escaped;
      }
      stream.writeWhitespacePadding();
      stream.writeToken(escaped);
    });
  }

  writeCast(toType: CodeTypeSpec): { source: CodeExpressionWriter } {
    const result = {
      source: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        stream.writeTypeSpec(toType);
        stream.writeToken('.');
        stream.writeToken('cast');
        stream.writeToken('(');
        result.source.writerFunc(stream, context);
        stream.writeToken(')');
      } else if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeTypeSpec(toType);
        stream.writeToken('(');
        result.source.writerFunc(stream, context);
        stream.writeToken(')');
      } else {
        stream.writeToken('(');
        stream.writeToken('(');
        stream.writeTypeSpec(toType);
        stream.writeToken(')');
        result.source.writerFunc(stream, context);
        stream.writeToken(')');
      }
    });
    return result;
  }

  writeVariableReference(ref: CodeVariable|CodeNamedToken) {
    const isRef = ref instanceof CodeVariable && ref.typeSpec.isReference;
    this.setWriter((stream, context) => {
      if (isRef) {
        //  && context.platform === CodeWriterPlatform.WebGPU && context.isGpu
        // TODO: Do we need to walk up the scope?
        const r = ref.group.scope.referenceExprs.find(r => r.identifier === ref.identifierToken);
        if (r) {
          r.writerFunc(stream, context);
          return;
        }
      }
      const identifierToken = ref instanceof CodeVariable ? ref.identifierToken : ref;
      stream.writeToken(identifierToken);
    });
  }
  writePropertyAccess(propertyName: CodeNamedToken): { source: CodeExpressionWriter } {
    const result = {
      source: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      result.source.writerFunc(stream, context);
      stream.writeToken('.');
      stream.writeToken(propertyName);
    });
    return result;
  }
  writePropertyReferenceAccess(propertyName: CodeNamedToken): { source: CodeExpressionWriter } {
    const result = {
      source: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken('&');
        stream.writeToken('(');
      }
      result.source.writerFunc(stream, context);
      stream.writeToken('.');
      stream.writeToken(propertyName);
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken(')');
      }
    });
    return result;
  }
  writeVariableReferenceReference(ref: CodeVariable|CodeNamedToken) {
    this.setWriter((stream, context) => {
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken('&');
        if (ref instanceof CodeVariable) {
          const r = ref.group.scope.referenceExprs.find(r => r.identifier === ref.identifierToken);
          if (r) {
            stream.writeToken('(');
            r?.writerFunc(stream, context);
            stream.writeToken(')');
            return;
          }
        }
      }
      if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) {
        if (ref instanceof CodeVariable) {
          const r = ref.group.scope.referenceExprs.find(r => r.identifier === ref.identifierToken);
          if (r) {
            stream.writeToken('(');
            r?.writerFunc(stream, context);
            stream.writeToken(')');
            return;
          }
        }
      }
      if (ref instanceof CodeVariable) {
        stream.writeToken(ref.identifierToken);
      } else {
        stream.writeToken(ref);
      }
    });
  }
  writeVariableDereference(ref: CodeVariable|CodeNamedToken) {
    this.setWriter((stream, context) => {
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken('*');
        if (ref instanceof CodeVariable) {
          const r = ref.group.scope.referenceExprs.find(r => r.identifier === ref.identifierToken);
          if (r) {
            stream.writeToken('(');
            r?.writerFunc(stream, context);
            stream.writeToken(')');
            return;
          }
        }
      }
      if (ref instanceof CodeVariable) {
        stream.writeToken(ref.identifierToken);
      } else {
        stream.writeToken(ref);
      }
    });
  }
  writeReferenceExpr(): { value: CodeExpressionWriter } {
    const result = {
      value: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken('&');
      }
      result.value.writerFunc(stream, context);
    });
    return result;
  }
  writeDereferenceExpr(): { value: CodeExpressionWriter } {
    const result = {
      value: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        stream.writeToken('*');
      }
      result.value.writerFunc(stream, context);
    });
    return result;
  }
  writeIndexAccess(options?: { indexLiteral?: number }): { index: CodeExpressionWriter, source: CodeExpressionWriter } {
    const result = {
      index: new CodeExpressionWriter(),
      source: new CodeExpressionWriter(),
    };
    if (options?.indexLiteral !== undefined) {
      result.index.writeLiteralInt(options.indexLiteral);
    }
    this.setWriter((stream, context) => {
      result.source.writerFunc(stream, context);
      stream.writeToken('[');
      result.index.writerFunc(stream, context);
      stream.writeToken(']');
    });
    return result;
  }
  writeMethodCall(methodName: CodeNamedToken): {
    source: CodeExpressionWriter,
    addArg(): CodeExpressionWriter,
    addTemplateArg(value: CodeTypeSpec): void,
  } {
    const params: CodeExpressionWriter[] = [];
    const typeArgs: CodeTypeSpec[] = [];
    const result = {
      source: new CodeExpressionWriter(),
      addArg() {
        const paramExpr = new CodeExpressionWriter();
        params.push(paramExpr);
        return paramExpr;
      },
      addTemplateArg(value: CodeTypeSpec) {
        typeArgs.push(value);
      },
    };
    this.setWriter((stream, context) => {
      result.source.writerFunc(stream, context)
      stream.writeToken('.');
      stream.writeToken(methodName);
      if (!(context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) &&
          typeArgs.length > 0) {
        stream.writeToken('<');
        for (let i = 0; i < typeArgs.length; ++i) {
          const typeArg = typeArgs[i];
          const isLast = i === typeArgs.length - 1;
          stream.writeTypeSpec(typeArg);
          if (!isLast) {
            stream.writeToken(',');
            stream.writeWhitespacePadding();
          }
        }
        stream.writeToken('>');
      }
      stream.writeToken('(');
      for (let i = 0; i < params.length; ++i) {
        const param = params[i];
        const isLast = i === params.length - 1;

        stream.writeWhitespacePadding();
        param.writerFunc(stream, context);
        if (!isLast) {
          stream.writeToken(',');
        }
      }
      stream.writeToken(')');
    });
    return result;
  }
  writeStaticFunctionCall(funcIdentifier: CodeNamedToken, options?: { overloadIndex?: number, requiresDirectAccess?: boolean }): {
    addArg(): CodeExpressionWriter,
    addTemplateArg(value: CodeTypeSpec): void,
    externCallSemantics: boolean,
  } {
    const params: CodeExpressionWriter[] = [];
    const typeArgs: CodeTypeSpec[] = [];
    const result = {
      addArg() {
        const paramExpr = new CodeExpressionWriter();
        params.push(paramExpr);
        return paramExpr;
      },
      addTemplateArg(value: CodeTypeSpec) {
        typeArgs.push(value);
      },
      externCallSemantics: false,
    };
    this.setWriter((stream, context) => {
      stream.writeToken(funcIdentifier);
      const overloadIndex = options?.overloadIndex ?? 0;
      const requiresDirectAccess = options?.requiresDirectAccess ?? false;
      if (context.platform === CodeWriterPlatform.WebGPU && context.isGpu) {
        if (overloadIndex > 0) {
          stream.writeToken(CodeExpressionWriter.formatLiteralIntToken(overloadIndex));
        }
        if (requiresDirectAccess) {
          stream.writeToken('_');
          stream.writeToken('storage');
        }
      }
      if (!(context.platform === CodeWriterPlatform.WebGPU && !context.isGpu) &&
          typeArgs.length > 0) {
        stream.writeToken('<');
        for (let i = 0; i < typeArgs.length; ++i) {
          const typeArg = typeArgs[i];
          const isLast = i === typeArgs.length - 1;
          stream.writeTypeSpec(typeArg);
          if (!isLast) {
            stream.writeToken(',');
            stream.writeWhitespacePadding();
          }
        }
        stream.writeToken('>');
      }
      stream.writeToken('(');
      if (context.platform === CodeWriterPlatform.WebGPU && !context.isGpu &&
          result.externCallSemantics &&
          typeArgs.length > 0) {
        for (let i = 0; i < typeArgs.length; ++i) {
          const typeArg = typeArgs[i];
          const isLast = i === typeArgs.length - 1 && params.length === 0;
          stream.writeWhitespacePadding();
          if (typeArg.asStruct) {
            stream.writeToken(typeArg.asStruct);
          } else {
            stream.writeToken('number');
          }
          if (!isLast) {
            stream.writeToken(',');
          }
        }
      }
      for (let i = 0; i < params.length; ++i) {
        const param = params[i];
        const isLast = i === params.length - 1;

        stream.writeWhitespacePadding();
        param.writerFunc(stream, context);
        if (!isLast) {
          stream.writeToken(',');
        }
      }
      stream.writeToken(')');
    });
    return result;
  }
  writeUnaryOperation(op: CodeUnaryOperator): { value: CodeExpressionWriter } {
    const result = {
      value: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      stream.writeToken('(');
      stream.writeToken(op.toString());
      stream.writeToken('(');
      result.value.writerFunc(stream, context);
      stream.writeToken(')');
      stream.writeToken(')');
    });
    return result;
  }
  writeBinaryOperation(op: CodeBinaryOperator): { lhs: CodeExpressionWriter, rhs: CodeExpressionWriter } {
    const result = {
      lhs: new CodeExpressionWriter(),
      rhs: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      stream.writeToken('(');
      result.lhs.writerFunc(stream, context);
      stream.writeWhitespacePadding();
      stream.writeToken(op.toString());
      stream.writeWhitespacePadding();
      result.rhs.writerFunc(stream, context);
      stream.writeToken(')');
    });
    return result;
  }
  writeInlineConditional(): { cond: CodeExpressionWriter, then: CodeExpressionWriter, else: CodeExpressionWriter } {
    const result = {
      cond: new CodeExpressionWriter(),
      then: new CodeExpressionWriter(),
      else: new CodeExpressionWriter(),
    };
    this.setWriter((stream, context) => {
      stream.writeToken('(');
      stream.writeToken('(');
      result.cond.writerFunc(stream, context);
      stream.writeToken(')');
      stream.writeWhitespace();
      stream.writeToken('?');
      stream.writeWhitespace();
      stream.writeToken('(');
      result.then.writerFunc(stream, context);
      stream.writeToken(')');
      stream.writeWhitespace();
      stream.writeToken(':');
      stream.writeWhitespace();
      stream.writeToken('(');
      result.else.writerFunc(stream, context);
      stream.writeToken(')');
      stream.writeToken(')');
    });
    return result;
  }
}




export class CodeNamedToken {
  constructor(
    public readonly nameHint: string,
  ) {}
}

export class CodeTextStream {
  private readonly spacesPerIndent = 2;

  private indentLevel = 0;
  private lines: string[] = [];
  private line = '';
  private indentStr?: string;
  private lineNeedsPadding = false;
  private blockCommentLevel = 0;

  constructor(
    public readonly context: CodeWriterContext,
    public readonly namedTokens: Map<CodeNamedToken, string>,
  ) {}

  indent(levels: number = 1) { this.indentLevel += levels; this.indentStr = undefined; }
  unindent(levels: number = 1) { this.indentLevel -= levels; this.indentStr = undefined; }
  writeLine(line: string) {
    this.flushLine();
    this.lines.push(line.padStart(this.indentLevel * this.spacesPerIndent));
  }

  writeWhitespacePadding() {
    if (this.lineNeedsPadding) {
      this.writeWhitespace();
    }
  }
  writeWhitespace() {
    this.writeToken(' ');
    this.lineNeedsPadding = false;
  }
  writeToken(token: CodeNamedToken|string) {
    let str: string;
    if (token instanceof CodeNamedToken) {
      str = this.translateToken(token);
      if (this.context.platform === CodeWriterPlatform.WebGPU && this.context.isGpu) {
        str = WEBGPU_GPU_RENAMES[str] ?? str;
        str = str.replaceAll('::', '_');
      } else if (this.context.platform === CodeWriterPlatform.WebGPU && !this.context.isGpu) {
        str = WEBGPU_CPU_RENAMES[str] ?? str;
        str = str.replaceAll('::', '.');
      }
    } else {
      str = token;
    }
    this.line += str;
    if (str.length > 0) {
      this.lineNeedsPadding = str.charAt(str.length - 1).match(/[\[{(]/g) == null;
    }
  }
  writeBlockCommentBegin() {
    if (this.blockCommentLevel > 0) {
      this.writeToken('/-');
    } else {
      this.writeToken('/*');
    }
    this.blockCommentLevel++;
  }
  writeBlockCommentEnd() {
    this.blockCommentLevel--;
    if (this.blockCommentLevel > 0) {
      this.writeToken('-/');
    } else {
      this.writeToken('*/');
    }
  }
  writeBlockComment(content: string) {
    this.writeBlockCommentBegin();
    this.writeWhitespace();
    this.writeToken(content.replaceAll('/*', '/+').replaceAll('*/', '+/'));
    this.writeWhitespace();
    this.writeBlockCommentEnd();
  }
  writeTypeSpec(typeSpec: CodeTypeSpec) {
    if (this.context.platform === CodeWriterPlatform.WebGPU && !this.context.isGpu) {
      // JavaScript fun.
      if (typeSpec.asPrimitive) {
        let str: string = typeSpec.asPrimitive;
        str = WEBGPU_CPU_RENAMES[str] ?? str;
        this.writeToken(str);
      } else if (typeSpec.asStruct) {
        this.writeToken(typeSpec.asStruct);

        if (DEBUG && typeSpec.typeArgs.length > 0) {
          this.writeWhitespacePadding();
          this.writeBlockCommentBegin();
          this.writeWhitespace();
          this.writeToken('<');
          for (let i = 0; i < typeSpec.typeArgs.length; ++i) {
            const typeArg = typeSpec.typeArgs[i];
            const isLast = i === typeSpec.typeArgs.length - 1;
            this.writeTypeSpec(typeArg);
            if (!isLast) {
              this.writeToken(',');
              this.writeWhitespacePadding();
            }
          }
          this.writeToken('>');
          this.writeWhitespace();
          this.writeBlockCommentEnd();
        }
      } else {
        throw new Error(`Type ${typeSpec} is undefined.`);
      }
      return;
    }
    if (typeSpec.isReference) {
      if (this.context.platform === CodeWriterPlatform.WebGPU && this.context.isGpu) {
        this.writeToken('ptr');
        this.writeToken('<');
        this.writeToken('function');
        this.writeToken(',');
        this.writeWhitespacePadding();
      }
    }
    if (typeSpec.isConst) {
      this.writeToken('const');
      this.writeWhitespace();
    }
    if (typeSpec.isArray) {
      if (this.context.platform === CodeWriterPlatform.WebGPU && this.context.isGpu) {
        this.writeToken('array');
        this.writeToken('<');
      }
    }
    if (typeSpec.asPrimitive) {
      let str: string = typeSpec.asPrimitive;
      if (this.context.platform === CodeWriterPlatform.WebGPU && this.context.isGpu) {
        str = WEBGPU_GPU_RENAMES[str] ?? str;
      }
      this.writeToken(str);
    } else if (typeSpec.asStruct) {
      this.writeToken(typeSpec.asStruct);
    } else {
      throw new Error(`Type ${typeSpec} is undefined.`);
    }
    if (typeSpec.typeArgs.length > 0) {
      this.writeToken('<');
      for (let i = 0; i < typeSpec.typeArgs.length; ++i) {
        const typeArg = typeSpec.typeArgs[i];
        const isLast = i === typeSpec.typeArgs.length - 1;
        this.writeTypeSpec(typeArg);
        if (!isLast) {
          this.writeToken(',');
          this.writeWhitespacePadding();
        }
      }
      this.writeToken('>');
    }
    if (typeSpec.isReference) {
      if (this.context.platform === CodeWriterPlatform.WebGPU && this.context.isGpu) {
        this.writeToken('>');
      } else {
        this.writeToken('&');
      }
    }
    if (typeSpec.isPointer) {
      this.writeToken('*');
    }
    if (typeSpec.isArray) {
      if (this.context.platform === CodeWriterPlatform.WebGPU && this.context.isGpu) {
        this.writeToken('>');
      } else {
        this.writeToken('[');
        this.writeToken(']');
      }
    }
  }

  flushLine() {
    if (this.line.length === 0) {
      return;
    }
    if (this.indentStr === undefined) {
      this.indentStr = ''.padStart(this.indentLevel * this.spacesPerIndent);
    }
    this.lines.push(this.indentStr + this.line);
    this.line = '';
    this.lineNeedsPadding = false;
  }

  translateToken(namedToken: CodeNamedToken): string {
    const identifier = this.namedTokens.get(namedToken);
    if (identifier === undefined) {
      throw new Error(`Token ${namedToken} has not been mapped to an identifier.`);
    }
    return identifier;
  }

  getOuterCode() {
    return this.lines.join('\n');
  }
}

export function getTrace(): string {
  if (!TRACE) {
    return '';
  }
  const stacktrace = new Error().stack ?? '';
  return stacktrace.replace(/^Error\n.*\n/g, '\n');
}
