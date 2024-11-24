import * as utils from '../utils';
import ts from "typescript";
import { BopProcessor } from './bop-processor';
import { evalJavascriptInContext, PushInternalContinueFlag, SharedMTLInternals } from './bop-javascript-lib';


















// function test(a: int): void;
// function test(a: float): void;
// function test(a: float, b: int): void;
// function test(a: int, b: float): void;
// function test(a: int|float, b?: int|float): void {
// }


// function doSomething() {
//   test(1 as float, 2 as int);
// }






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

  const processor = new BopProcessor(program, root);
  const { cpuPrepareCode, cpuRunFrameCode, gpuCode } = processor.compile();

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





class CodeSystem implements ts.System {
  args = [];
  newLine = '\n';
  useCaseSensitiveFileNames = true;
  write(s: string): void {}
  // writeOutputIsTTY?(): boolean;
  // getWidthOfTerminal?(): number;
  readFile(path: string, encoding?: string): string | undefined { return ''; }
  // getFileSize?(path: string): number;
  writeFile(path: string, data: string, writeByteOrderMark?: boolean): void {}
  // /**
  //   * @pollingInterval - this parameter is used in polling-based watchers and ignored in watchers that
  //   * use native OS file watching
  //   */
  // watchFile?(path: string, callback: FileWatcherCallback, pollingInterval?: number, options?: WatchOptions): FileWatcher;
  // watchDirectory?(path: string, callback: DirectoryWatcherCallback, recursive?: boolean, options?: WatchOptions): FileWatcher;
  resolvePath(path: string): string { return path; };
  fileExists(path: string): boolean { return true; }
  directoryExists(path: string): boolean { return true; }
  createDirectory(path: string): void {}
  getExecutingFilePath(): string { return '/'; }
  getCurrentDirectory(): string { return '/'; }
  getDirectories(path: string): string[] { return []; }
  readDirectory(path: string, extensions?: readonly string[], exclude?: readonly string[], include?: readonly string[], depth?: number): string[] { return []; }
  // getModifiedTime?(path: string): Date | undefined;
  // setModifiedTime?(path: string, time: Date): void;
  // deleteFile?(path: string): void;
  // /**
  //   * A good implementation is node.js' `crypto.createHash`. (https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm)
  //   */
  // createHash?(data: string): string;
  // /** This must be cryptographically secure. Only implement this method using `crypto.createHash("sha256")`. */
  // createSHA256Hash?(data: string): string;
  // getMemoryUsage?(): number;
  exit(exitCode?: number): void {}
  // realpath?(path: string): string;
  // setTimeout?(callback: (...args: any[]) => void, ms: number, ...args: any[]): any;
  // clearTimeout?(timeoutId: any): void;
  // clearScreen?(): void;
  // base64decode?(input: string): string;
  // base64encode?(input: string): string;
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









