import * as utils from '../utils';

export enum CodePrimitiveType {
  Void = 'void',
  Type = 'type',
  Function = 'function',
  Bool = 'bool',
  Int = 'int32_t',
  CompileError = 'CompileError',
}

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
    public isReference: boolean = false,
    public isPointer: boolean = false,
    public isConst: boolean = false,
    public isArray: boolean = false,
  ) {}

  toCopy() {
    return new CodeTypeSpec(
      this.asStruct,
      this.asPrimitive,
      this.isReference,
      this.isPointer,
      this.isConst,
      this.isArray,
    );
  }

  toReference(value: boolean = true) { const copy = this.toCopy(); copy.isReference = value; return copy; }
  toConst(value: boolean = true) { const copy = this.toCopy(); copy.isConst = value; return copy; }
  toArray(value: boolean = true) { const copy = this.toCopy(); copy.isArray = value; return copy; }

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
  ) {
    this.identifierToken = new CodeNamedToken(nameHint);
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
    const newGroup = new CodeVariableGroup(this);
    this.groups.push(newGroup);
    const newVar = new CodeVariable(type, nameHint, newGroup);
    newGroup.vars.push(newVar);
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

  allocateVariableIdentifier(type: CodeTypeSpec, prefix: string, nameHint: string): CodeVariable {
    const newVar = new CodeVariable(type, nameHint, new CodeVariableGroup(this));
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

  constructor() {
  }

  mapInternalToken(identifierToken: CodeNamedToken, internalIdentifier: string) {
    this.internalTokens.set(identifierToken, internalIdentifier);
  }

  getOuterCode(): string {
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

    const stream = new CodeTextStream(identifierMap);

    this.global.writerFunc(stream);
    return stream.getOuterCode();
  }

  sanitizeIdentifier(str: string): string {
    return str.replaceAll(/[^a-zA-Z0-9]/g, '_');
  }
}

type CodeWriterFunc = (stream: CodeTextStream) => void;
function makeInvokeCodeWriterFuncHelper(stream: CodeTextStream) {
  return (func: CodeWriterFunc) => func(stream);
}

interface CodeWriterFragment {
  get writerFunc(): CodeWriterFunc;
}

export class CodeGlobalWriter implements CodeWriterFragment {
  public readonly scope: CodeScope = CodeScope.createGlobalScope();

  private typeWriters: CodeWriterFunc[] = [];
  private typeIdentifiers: CodeNamedToken[] = [];
  private functionWriters: CodeWriterFunc[] = [];
  private functionIdentifiers: CodeNamedToken[] = [];

  get writerFunc(): CodeWriterFunc {
    return stream => {
      this.typeWriters.forEach(makeInvokeCodeWriterFuncHelper(stream));
      this.functionWriters.forEach(makeInvokeCodeWriterFuncHelper(stream));
    };
  }

  writeFunction(identifier: CodeNamedToken): {
    body: CodeStatementWriter,
    returnTypeSpec: CodeTypeSpec,
    addParam(typeSpec: CodeTypeSpec, identifier: CodeNamedToken): void,
  } {
    const functionScope = this.scope.createChildScope(CodeScopeType.Function);
    const params: Array<{ typeSpec: CodeTypeSpec, identifier: CodeNamedToken }> = [];
    const result = {
      body: new CodeStatementWriter(functionScope),
      returnTypeSpec: CodeTypeSpec.voidType,
      addParam(typeSpec: CodeTypeSpec, identifier: CodeNamedToken) {
        params.push({ typeSpec, identifier });
      },
    };
    this.functionIdentifiers.push(identifier);
    this.functionWriters.push(stream => {
      stream.writeTypeSpec(result.returnTypeSpec);
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
        stream.writeTypeSpec(param.typeSpec);
        stream.writeWhitespace();
        stream.writeToken(param.identifier);
      }

      stream.writeToken(')');
      stream.writeWhitespace();
      stream.writeToken('{');
      stream.flushLine();
      stream.indent();
      result.body.writerFunc(stream);
      stream.flushLine();
      stream.unindent();
      stream.writeToken('}');
      stream.flushLine();
    });
    return result;
  }

  writeStruct(identifier: CodeNamedToken): { struct: CodeStructWriter } {
    const result = {
      struct: new CodeStructWriter(this.scope.createChildScope(CodeScopeType.Class)),
    };
    this.typeIdentifiers.push(identifier);
    this.typeWriters.push(stream => {
      stream.writeToken('struct');
      stream.writeWhitespace();
      stream.writeToken(identifier);
      stream.writeWhitespace();
      stream.writeToken('{');
      stream.flushLine();
      stream.indent();
      result.struct.writerFunc(stream);
      stream.flushLine();
      stream.unindent();
      stream.writeToken('};');
      stream.flushLine();
    });
    return result;
  }
}

export class CodeStructWriter implements CodeWriterFragment {
  private fieldWriterFuncs: CodeWriterFunc[] = [];

  constructor(
    public readonly scope: CodeScope,
  ) {}

  get writerFunc(): CodeWriterFunc {
    return stream => {
      this.fieldWriterFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream));
    };
  }

  writeField(identifier: CodeNamedToken, typeSpec: CodeTypeSpec) {
    this.fieldWriterFuncs.push(stream => {
      stream.writeTypeSpec(typeSpec);
      stream.writeWhitespace();
      stream.writeToken(identifier);
      stream.writeToken(';');
      stream.flushLine();
    });
  }
}

export class CodeStatementWriter implements CodeWriterFragment {
  private statementWriterFuncs: CodeWriterFunc[] = [];

  get writerFunc(): CodeWriterFunc {
    return stream => {
      this.statementWriterFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream));
    };
  }

  constructor(
    public readonly scope: CodeScope,
  ) {}

  writeVariableDeclaration(thisVar: CodeVariable): { initializer: CodeInitializerWriter } {
    const result = {
      initializer: new CodeInitializerWriter(),
    };
    this.statementWriterFuncs.push(stream => {
      stream.writeTypeSpec(thisVar.typeSpec);
      stream.writeWhitespace();
      stream.writeToken(thisVar.identifierToken);
      if (result.initializer.isDefined) {
        stream.writeWhitespacePadding();
        stream.writeToken('=');
        stream.writeWhitespacePadding();
        result.initializer.writerFunc(stream);
      }
      stream.writeToken(';');
      stream.flushLine();
    });
    return result;
  }
  writeAssignmentStatement(): { ref: CodeExpressionWriter, value: CodeExpressionWriter } {
    const result = {
      ref: new CodeExpressionWriter(),
      value: new CodeExpressionWriter(),
    };
    this.statementWriterFuncs.push(stream => {
      result.ref.writerFunc(stream);
      stream.writeWhitespacePadding();
      stream.writeToken('=');
      stream.writeWhitespacePadding();
      result.value.writerFunc(stream);
      stream.writeToken(';');
      stream.flushLine();
    });
    return result;
  }
  writeExpressionStatement(): { expr: CodeExpressionWriter } {
    const result = {
      expr: new CodeExpressionWriter(),
    };
    this.statementWriterFuncs.push(stream => {
      result.expr.writerFunc(stream);
      stream.writeToken(';');
      stream.flushLine();
    });
    return result;
  }
  writeConditional(branchCount: number): { branches: CodeBranchWriter[] } {
    const branches = Array.from(utils.range(branchCount)).map(i => new CodeBranchWriter(new CodeExpressionWriter(), new CodeStatementWriter(this.scope.createChildScope(CodeScopeType.Local))));
    const result = {
      branches: branches,
    };
    this.statementWriterFuncs.push(stream => {
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
          branch.condWriter.writerFunc(stream);
          stream.unindent(2);
          stream.writeToken(')');
          stream.writeWhitespace();
        }
        stream.writeToken('{');
        stream.flushLine();
        stream.indent();
        branch.blockWriter.writerFunc(stream);
        stream.flushLine();
        stream.unindent();
        stream.writeToken('}');
      }
      stream.flushLine();
    });
    return result;
  }
  writeReturnStatement(): { expr: CodeExpressionWriter } {
    const result = {
      expr: new CodeExpressionWriter(),
    };
    this.statementWriterFuncs.push(stream => {
      stream.writeToken('return');
      if (result.expr.isDefined) {
        stream.writeWhitespace();
        result.expr.writerFunc(stream);
      }
      stream.writeToken(';');
      stream.flushLine();
    });
    return result;
  }
}

export class CodeBranchWriter {
  constructor(
    public readonly condWriter: CodeExpressionWriter,
    public readonly blockWriter : CodeStatementWriter,
  ) {}
}

export enum CodeUnaryOperator {
  Negate = '-',
  LogicalNot = '!',
}

export enum CodeBinaryOperator {
  Add = '+',
  Subtract = '-',
  Multiply = '*',
  Divide = '/',
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

  get writerFunc(): CodeWriterFunc {
    if (!this.writerFuncField) {
      throw new Error('Expression is not yet defined.');
    }
    return this.writerFuncField;
  }

  protected setWriter(func: CodeWriterFunc) {
    if (this.writerFuncField) {
      throw new Error('Expression is already defined.');
    }
    this.writerFuncField = func;
  }

  protected setWriterFromFragment(fragment: CodeWriterFragment) {
    this.setWriter(stream => fragment.writerFunc(stream));
  }
}

export class CodeInitializerWriter extends CodeExpressionWriterBase {
  private isStructInitializer?: boolean;
  private structFieldInitializerFuncs: CodeWriterFunc[] = [];

  writeExpression(): CodeExpressionWriter {
    const result = new CodeExpressionWriter();
    this.setWriterFromFragment(result);
    return result;
  }

  writeAssignStructField(fieldIdentifier: CodeNamedToken): { value: CodeExpressionWriter } {
    if (this.isStructInitializer === undefined) {
      this.setWriter(stream => {
        stream.writeWhitespacePadding();
        stream.writeToken('{');
        if (this.structFieldInitializerFuncs.length == 1) {
          stream.writeWhitespace();
          this.structFieldInitializerFuncs.forEach(makeInvokeCodeWriterFuncHelper(stream));
          stream.writeWhitespace();
        } else {
          stream.flushLine();
          stream.indent(2);
          for (const func of this.structFieldInitializerFuncs) {
            func(stream);
            stream.writeToken(',');
            stream.flushLine();
          }
          stream.unindent(2);
        }
        stream.writeToken('}');
      });
      this.isStructInitializer = true;
    } else if (!this.isStructInitializer) {
      throw new Error('Cannot change an expression initializer into a struct initializer.');
    }
    const result = {
      value: new CodeExpressionWriter(),
    };
    this.structFieldInitializerFuncs.push(stream => {
      stream.writeToken('.');
      stream.writeToken(fieldIdentifier);
      stream.writeWhitespace();
      stream.writeToken('=');
      stream.writeWhitespace();
      result.value.writerFunc(stream);
    });
    return result;
  }
}

export class CodeExpressionWriter extends CodeExpressionWriterBase {
  writeLiteralNullptr() { this.writeLiteralImpl('nullptr'); }
  writeLiteralBool(value: boolean) { this.writeLiteralImpl(value ? 'true' : 'false'); }
  writeLiteralInt(value: number) { this.writeLiteralImpl(Math.round(value).toString()); }
  writeLiteralFloat(value: number) { this.writeLiteralImpl(`${value.toString()}f`); }
  writeLiteralDouble(value: number) { this.writeLiteralImpl(value.toString()); }
  private writeLiteralImpl(literal: string) {
    this.setWriter(stream => {
      stream.writeWhitespacePadding();
      stream.writeToken(literal);
    });
  }

  writeVariableReference(ref: CodeVariable) {
    this.setWriter(stream => {
      stream.writeToken(ref.identifierToken);
    });
  }
  writePropertyAccess(propertyName: CodeNamedToken): { source: CodeExpressionWriter } {
    const result = {
      source: new CodeExpressionWriter(),
    };
    this.setWriter(stream => {
      result.source.writerFunc(stream);
      stream.writeToken('.');
      stream.writeToken(propertyName);
    });
    return result;
  }
  writeStaticFunctionCall(funcIdentifier: CodeNamedToken): {
    addArg(): CodeExpressionWriter,
  } {
    const params: CodeExpressionWriter[] = [];
    const result = {
      addArg() {
        const paramExpr = new CodeExpressionWriter();
        params.push(paramExpr);
        return paramExpr;
      },
    };
    this.setWriter(stream => {
      stream.writeToken(funcIdentifier);
      stream.writeToken('(');
      for (let i = 0; i < params.length; ++i) {
        const param = params[i];
        const isLast = i === params.length - 1;

        stream.writeWhitespacePadding();
        param.writerFunc(stream);
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
    this.setWriter(stream => {
      stream.writeToken('(');
      stream.writeToken(op.toString());
      result.value.writerFunc(stream);
      stream.writeToken(')');
    });
    return result;
  }
  writeBinaryOperation(op: CodeBinaryOperator): { lhs: CodeExpressionWriter, rhs: CodeExpressionWriter } {
    const result = {
      lhs: new CodeExpressionWriter(),
      rhs: new CodeExpressionWriter(),
    };
    this.setWriter(stream => {
      stream.writeToken('(');
      result.lhs.writerFunc(stream);
      stream.writeWhitespacePadding();
      stream.writeToken(op.toString());
      stream.writeWhitespacePadding();
      result.rhs.writerFunc(stream);
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

  constructor(
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
    } else {
      str = token;
    }
    this.line += str;
    if (str.length > 0) {
      this.lineNeedsPadding = str.charAt(str.length - 1).match(/[\[{(]/g) == null;
    }
  }
  writeTypeSpec(typeSpec: CodeTypeSpec) {
    if (typeSpec.isConst) {
      this.writeToken('const');
      this.writeWhitespace();
    }
    if (typeSpec.asPrimitive) {
      this.writeToken(typeSpec.asPrimitive);
    } else if (typeSpec.asStruct) {
      this.writeToken(typeSpec.asStruct);
    } else {
      throw new Error(`Type ${typeSpec} is undefined.`);
    }
    if (typeSpec.isReference) {
      this.writeToken('&');
    }
    if (typeSpec.isPointer) {
      this.writeToken('*');
    }
    if (typeSpec.isArray) {
      this.writeToken('[');
      this.writeToken(']');
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
