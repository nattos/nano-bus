import * as utils from '../utils';
import ts from "typescript/lib/typescript";
import { CodeVariable, CodeWriter, CodeWriterPlatform } from "./code-writer";
import { BapVisitorRootContext } from "./bap-visitor";
import { BapTypes } from "./bap-types";
import { BopIdentifierPrefix } from "./bop-data";
import { evalJavascriptInContext, PushInternalContinueFlag, SharedMTLInternals } from './bop-javascript-lib';
import { writeSourceNodeCode } from './bap-processor';

export interface CompiledDebugIn {
  lineNumber: number;
  valueLength: number;
  defaultValue: number[];
}

export interface CompiledDebugOut {
  lineNumber: number;
  expectedValueLength: number;
}

export interface CompileMessage {
  message: string;
}

export interface CompileResult {
  isRunnable: boolean;
  frameRunner: FrameRunner;
  messages: CompileMessage[];
  debugIns: CompiledDebugIn[];
  debugOuts: CompiledDebugOut[];
}

export interface FrameRunner {
  runOneFrame(): Promise<void>;
}

export async function compile(code: string): Promise<CompileResult> {
  const libCode = await (await fetch('/bop-lib-code.d.ts')).text();

  const compilerHost = new MemoryCompilerHost(new Map<string, string>([
    [ 'test.ts', code ],
    [ 'default.d.ts', libCode ],
  ]));
  const program = ts.createProgram(['test.ts'], {}, compilerHost);
  const root = program.getSourceFile('test.ts')!;

  const { cpuPrepareCode, cpuRunFrameCode, gpuCode } = translateProgram({ program, sourceRoot: root });

  let prepared = false;
  const frameRunner: FrameRunner = {
    async runOneFrame() {
      if (!prepared) {
        prepared = true;
        SharedMTLInternals().loadShaderCode(gpuCode);
        const continueFlag = new utils.Resolvable<unknown>();
        PushInternalContinueFlag(continueFlag);
        evalJavascriptInContext(cpuPrepareCode);
        await continueFlag.promise;
      }
      const continueFlag = new utils.Resolvable<unknown>();
      PushInternalContinueFlag(continueFlag);
      evalJavascriptInContext(cpuRunFrameCode);
      await continueFlag.promise;
    },
  };

  return {
    isRunnable: true,
    frameRunner,
    messages: [],
    debugIns: [],
    debugOuts: [],
  };
}

function translateProgram(init: {
  program: ts.Program,
  sourceRoot: ts.SourceFile,
}) {
  // const tc: ts.TypeChecker;
  const writer = new CodeWriter();
  // // const globalBlock: BopBlock;
  // const blockWriter: CodeStatementWriter;
  // const initFuncIdentifier: CodeNamedToken;
  // const initFuncBlockWriter: CodeStatementWriter;
  // const runFuncIdentifier: CodeNamedToken;
  // const runFuncBlockWriter: CodeStatementWriter;
  // // block: BopBlock;
  // // const scopeReturnType: BopType;
  // // asAssignableRef = false;
  // // private unrolledBlocks?: BopStage[];

  // const instanceVarsIdentifier: CodeVariable;
  // const instanceBlockWriter: CodeStructWriter;
  // const instanceScope: CodeScope;
  const prepareFuncs: CodeVariable[] = [];
  const runFuncs: CodeVariable[] = [];



  const tc = init.program.getTypeChecker();
  // sourceRoot.statements.forEach(this.printRec.bind(this));

  const initFuncIdentifier = writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Function, 'init');
  const initFunc = writer.global.writeFunction(initFuncIdentifier);
  initFunc.touchedByCpu = true;
  const initFuncBlockWriter = initFunc.body;

  const runFuncIdentifier = writer.global.scope.allocateIdentifier(BopIdentifierPrefix.Function, 'run');
  const runFunc = writer.global.writeFunction(runFuncIdentifier);
  runFunc.touchedByCpu = true;
  const blockWriter = runFunc.body;
  const runFuncBlockWriter = runFunc.body;

  // globalBlock = BopBlock.createGlobalBlock();
  // block = globalBlock;

  // const instanceScope = writer.global.scope.createChildScope(CodeScopeType.Class);
  // const instanceVarsTypeIdentifier = writer.makeInternalToken('InstanceVars2');
  // const instanceBlockWriter = writer.global.writeStruct(instanceVarsTypeIdentifier);
  // instanceBlockWriter.isInternalOnly = true;
  // instanceBlockWriter.touchedByGpu = false;
  // const instanceVarsToken = writer.makeInternalToken('instanceVars2');
  // const instanceVarsIdentifier = writer.global.scope.allocateVariableIdentifier(CodeTypeSpec.fromStruct(instanceVarsTypeIdentifier), BopIdentifierPrefix.Local, 'instanceVars', { fixedIdentifierToken: instanceVarsToken });

    // // Map intrinsic types.
    // this.underscoreIdentifier = this.writer.makeInternalToken('_');
    // this.errorType = this.createPrimitiveType(CodeTypeSpec.compileErrorType);
    // this.wouldBeAnyType = this.createPrimitiveType(CodeTypeSpec.compileErrorType);
    // this.functionType = this.createPrimitiveType(CodeTypeSpec.functionType);
    // this.typeType = this.createPrimitiveType(CodeTypeSpec.typeType);
    // this.typeMap.set(this.tc.getVoidType(), this.voidType = this.createPrimitiveType(CodeTypeSpec.voidType));
    // this.typeMap.set(this.tc.getBooleanType(), this.booleanType = this.createPrimitiveType(CodeTypeSpec.boolType));
    // this.undefinedType = this.createInternalType({ identifier: 'UndefinedType', anonymous: true }).type;
    // this.undefinedConstant = this.createInternalConstant({ identifier: 'undefined', internalIdentifier: 'kUndefinedValue', type: this.undefinedType });
    // this.privateTypes = {
    //   MTLDevice: this.createInternalType({ identifier: 'id<MTLDevice>', anonymous: true }).type,
    //   MTLFunction: this.createInternalType({ identifier: 'id<MTLFunction>', anonymous: true }).type,
    //   MTLRenderPipelineDescriptor: this.createInternalType({ identifier: 'MTLRenderPipelineDescriptor*', anonymous: true }).type,
    //   MTLRenderPassDescriptor: this.createInternalType({ identifier: 'MTLRenderPassDescriptor*', anonymous: true }).type,
    //   MTLRenderCommandEncoder: this.createInternalType({ identifier: 'id<MTLRenderCommandEncoder>', anonymous: true }).type,
    //   MTLPrimitiveTypeTriangle: this.createInternalType({ identifier: 'MTLPrimitiveTypeTriangle', anonymous: true }).type,
    //   MTLComputePipelineDescriptor: this.createInternalType({ identifier: 'MTLComputePipelineDescriptor*', anonymous: true }).type,
    //   MTLComputePassDescriptor: this.createInternalType({ identifier: 'MTLComputePassDescriptor*', anonymous: true }).type,
    //   MTLComputeCommandEncoder: this.createInternalType({ identifier: 'id<MTLComputeCommandEncoder>', anonymous: true }).type,
    //   BufferFiller: this.createInternalType({ identifier: 'BufferFiller', anonymous: true }).type,
    // };


    // const { libTypes, newBopTypeMap } = loadBopLib(this);

    // this.intType = newBopTypeMap.get('int')!.bopType!;
    // this.floatType = newBopTypeMap.get('float')!.bopType!;
    // this.float4Type = newBopTypeMap.get('float4')!.bopType!;
    // this.libTypes = {
    //   Texture: newBopTypeMap.get('Texture')!.bopType!,
    // };
    // // this.typeMap.set(this.tc.getNumberType(), this.intType); // TODO: FIX!!!

    // for (const type of libTypes.values()) {
    //   const typeArgs = type.typeParameters.map(t => utils.upcast({ name: t, typeArgs: [] }));
    //   const typeName = toStringResolvedType({ name: type.name, typeArgs });
    //   for (const prop of type.properties) {
    //     const propType = prop.type(typeArgs);
    //     // console.log(`${typeName}.${prop.name}: ${toStringResolvedType(propType)}`);
    //   }
    //   for (const method of type.methods) {
    //     const methodTypeArgs = method.typeParameters.map(t => utils.upcast({ name: t, typeArgs: [] }));
    //     let methodName = method.name;
    //     if (methodTypeArgs.length > 0) {
    //       methodName += `<${methodTypeArgs.map(toStringResolvedType).join(', ')}>`;
    //     }
    //     // console.log(`${typeName}.${methodName}(${method.parameters.map(p => `${p.name}: ${toStringResolvedType(p.type(typeArgs, methodTypeArgs))}`).join(', ')}): ???`);
    //   }
    // }
    // // console.log(Array.from(libTypes.values()));

    // this.scopeReturnType = this.errorType;





  let types: BapTypes;
  const rootContext: BapVisitorRootContext = {
    program: init.program,
    sourceRoot: init.sourceRoot,
    tc: tc,
    get types() { return types; },
    globals: {
      prepareFuncs: prepareFuncs,
    },
  };
  types = new BapTypes(rootContext);

  // Walk the tree.
  writeSourceNodeCode(init.sourceRoot, rootContext, blockWriter, writer);

  for (const prepareFunc of prepareFuncs) {
    initFuncBlockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(prepareFunc.identifierToken);
  }
  for (const runFunc of runFuncs) {
    runFuncBlockWriter.writeExpressionStatement().expr.writeStaticFunctionCall(runFunc.identifierToken);
  }

  // utils.visitRec(
  //     this.bopFunctionConcreteImpls.filter(impl => impl.touchedByCpu),
  //     node => Array.from(node.references),
  //     node => node.touchedByCpu = true);
  // utils.visitRec(
  //     this.bopFunctionConcreteImpls.filter(impl => impl.touchedByGpu),
  //     node => Array.from(node.references),
  //     node => node.touchedByGpu = true);

  const platform = CodeWriterPlatform.WebGPU;
  const { code: cpuCode, translatedTokens } = writer.getOuterCode(false, platform, { translateTokens: [ initFuncIdentifier, runFuncIdentifier ] });
  console.log(cpuCode);
  const { code: gpuCode } = writer.getOuterCode(true, platform);
  console.log(gpuCode);

  const initFuncName = translatedTokens.get(initFuncIdentifier);
  const runFuncName = translatedTokens.get(runFuncIdentifier);

  const cpuPrepareCode = `
const instanceVars = {};
` + cpuCode + `
(async () => {
  const continueFlag = PopInternalContinueFlag();
  await WaitForInternalsReady();
  ${initFuncName}();
  continueFlag?.resolve(undefined);
})();
`;
    const cpuRunFrameCode = `
(async () => {
  const continueFlag = PopInternalContinueFlag();
  InternalMarkFrameStart();
  ${runFuncName}();
  InternalMarkFrameEnd();
  continueFlag?.resolve(undefined);
})();
`;
  return { cpuPrepareCode, cpuRunFrameCode, gpuCode };
}




class MemoryCompilerHost implements ts.CompilerHost {
  constructor(public codeFiles: Map<string, string>) {}

  fileExists(fileName: string): boolean {
    // console.log(`readFile ${fileName}`);
    return true;
  }
  readFile(fileName: string): string | undefined {
    // console.log(`readFile ${fileName}`);
    return '';
  }
  // trace?(s: string): void;
  // directoryExists?(directoryName: string): boolean;
  // realpath?(path: string): string;
  // getCurrentDirectory?(): string;
  // getDirectories?(path: string): string[];
  // useCaseSensitiveFileNames?: boolean | (() => boolean) | undefined;

  getSourceFile(fileName: string, languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined {
    // console.log(`getSourceFile ${fileName}: shouldCreateNewSourceFile: ${shouldCreateNewSourceFile}`);
    const code = this.codeFiles.get(fileName);
    if (code === undefined) {
      return undefined;
    }
    const root = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest);
    return root;
  }
  // getSourceFileByPath?(fileName: string, path: Path, languageVersionOrOptions: ScriptTarget | CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): SourceFile | undefined;
  // getCancellationToken?(): CancellationToken;
  getDefaultLibFileName(options: ts.CompilerOptions): string { return 'default'; }
  getDefaultLibLocation?(): string { return '/'; }
  writeFile: ts.WriteFileCallback = (fileName: string, text: string, writeByteOrderMark: boolean, onError?: (message: string) => void, sourceFiles?: readonly ts.SourceFile[], data?: ts.WriteFileCallbackData) => {};
  getCurrentDirectory(): string { return '/'; }
  getCanonicalFileName(fileName: string): string { return fileName; }
  useCaseSensitiveFileNames(): boolean { return true; }
  getNewLine(): string { return '\n'; }
  // readDirectory?(rootDir: string, extensions: readonly string[], excludes: readonly string[] | undefined, includes: readonly string[], depth?: number): string[];
  // resolveModuleNames?(moduleNames: string[], containingFile: string, reusedNames: string[] | undefined, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile?: SourceFile): (ResolvedModule | undefined)[];
  // getModuleResolutionCache?(): ts.ModuleResolutionCache | undefined;
  // resolveTypeReferenceDirectives?(typeReferenceDirectiveNames: string[] | readonly FileReference[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingFileMode?: ResolutionMode): (ResolvedTypeReferenceDirective | undefined)[];
  // resolveModuleNameLiterals?(moduleLiterals: readonly StringLiteralLike[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile, reusedNames: readonly StringLiteralLike[] | undefined): readonly ResolvedModuleWithFailedLookupLocations[];
  // resolveTypeReferenceDirectiveReferences?<T extends FileReference | string>(typeDirectiveReferences: readonly T[], containingFile: string, redirectedReference: ResolvedProjectReference | undefined, options: CompilerOptions, containingSourceFile: SourceFile | undefined, reusedNames: readonly T[] | undefined): readonly ResolvedTypeReferenceDirectiveWithFailedLookupLocations[];
  // getEnvironmentVariable?(name: string): string | undefined;
  // hasInvalidatedResolutions?(filePath: Path): boolean;
  // createHash?(data: string): string;
  // getParsedCommandLine?(fileName: string): ParsedCommandLine | undefined;
}
