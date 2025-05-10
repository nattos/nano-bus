import * as utils from '../utils';
import ts from "typescript/lib/typescript";
import { CodeVariable, CodeWriter, CodeWriterPlatform } from "./code-writer/code-writer";
import { BapVisitorRootContext } from "./bap-visitor";
import { BapTypes } from "./bap-types";
import { BapIdentifierPrefix } from "./bap-constants";
import { evalJavascriptInContext, PushInternalContinueFlag, SharedMTLInternals } from './runtime/bop-javascript-lib';
import { writeSourceNodeCode } from './bap-processor';
import { BapDebugInOuts } from './bap-debug-ins-outs';

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
  const libCode = await (await fetch('libcode/@types/bop-lib-code.d.ts')).text();

  const compilerHost = new MemoryCompilerHost(new Map<string, string>([
    [ 'test.ts', code ],
    [ 'default.d.ts', libCode ],
  ]));
  const program = ts.createProgram(['test.ts'], {}, compilerHost);
  const root = program.getSourceFile('test.ts')!;

  const {
    cpuPrepareCode, cpuRunFrameCode, gpuCode,
    cpuDebugIns, gpuDebugIns,
  } = translateProgram({ program, sourceRoot: root });

  let prepared = false;
  const frameRunner: FrameRunner = {
    async runOneFrame() {
      if (!prepared) {
        prepared = true;
        SharedMTLInternals().loadShaderCode(gpuCode);
        SharedMTLInternals().loadDebugIns(cpuDebugIns, gpuDebugIns);
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
  const writer = new CodeWriter();
  const prepareFuncs: CodeVariable[] = [];
  const runFuncs: CodeVariable[] = [];

  const tc = init.program.getTypeChecker();
  // sourceRoot.statements.forEach(this.printRec.bind(this));

  const initFuncIdentifier = writer.global.scope.allocateIdentifier(BapIdentifierPrefix.Function, 'init');
  const initFunc = writer.global.writeFunction(initFuncIdentifier);
  initFunc.touchedByCpu = true;
  const initFuncBlockWriter = initFunc.body;

  const runFuncIdentifier = writer.global.scope.allocateIdentifier(BapIdentifierPrefix.Function, 'run');
  const runFunc = writer.global.writeFunction(runFuncIdentifier);
  runFunc.touchedByCpu = true;
  const blockWriter = runFunc.body;
  const runFuncBlockWriter = runFunc.body;

  let types: BapTypes;
  const rootContext: BapVisitorRootContext = {
    program: init.program,
    sourceRoot: init.sourceRoot,
    tc: tc,
    get types() { return types; },
    debugInOuts: new BapDebugInOuts(),
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
  return { cpuPrepareCode, cpuRunFrameCode, gpuCode, cpuDebugIns: rootContext.debugInOuts.cpuIns, gpuDebugIns: rootContext.debugInOuts.gpuIns };
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
