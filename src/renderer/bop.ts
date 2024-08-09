import * as utils from '../utils';
import ts from "typescript";
import { BopProcessor } from './bop-processor';


















// function test(a: int): void;
// function test(a: float): void;
// function test(a: float, b: int): void;
// function test(a: int, b: float): void;
// function test(a: int|float, b?: int|float): void {
// }


// function doSomething() {
//   test(1 as float, 2 as int);
// }









export function compile(code: string) {
  // readonly identifier: string,
  // readonly parameters: LocalDecl[],
  // readonly returnType: TypeSpec,
  // readonly genericTypeParameters: TypeParameter[],
  // readonly statements: Expression[]) {}
  // let exprIndex = 0;
  // const returnNode: BuildNode;
  // const localMap = new Map<LocalDecl, BuildAlias>(func.parameters.map());

  // const expressionMap = new Map<Expression, BuildNode>();
  // const nodeList = Array.from(expressionMap.values()).concat(returnNode).concat(localMap);
  // // TODO: Recurse.
  // for (const s of func.statements) {
  //   if (s definesLocal) {
  //     localMap.;
  //   }
  //   if (s returns) {
  //     //
  //     returnNode.sets.push(expressionMap.get(s.returnExpr));
  //   } else if (s continues) {
  //     //
  //   } else if (s breaks) {
  //     //
  //   }
  //   // if (s terminatesAbnormally) {
  //   //   // Not supported?
  //   // }
  // }

  // const writer = new CodeWriter();
  // const structASymbol = writer.global.scope.allocateIdentifier('struct', 'A');
  // const structARet = writer.global.writeStruct(structASymbol);
  // const structAFieldX = structARet.struct.scope.allocateIdentifier('field', 'x');
  // const structAFieldY = structARet.struct.scope.allocateIdentifier('field', 'y');
  // structARet.struct.writeField(structAFieldX, CodeTypeSpec.intType);
  // structARet.struct.writeField(structAFieldY, CodeTypeSpec.intType);

  // const funcSomethingRet = writer.global.writeFunction(writer.global.scope.allocateIdentifier('f', 'funcSomething'), []);
  // {
  //   const aVar = funcSomethingRet.body.scope.createVariableInScope(CodeTypeSpec.fromStruct(structASymbol), 'aStruct');
  //   const stmt = funcSomethingRet.body.writeVariableDeclaration(aVar);
  //   stmt.initializer.writeAssignStructField(structAFieldX).value.writeLiteralInt(123);
  //   stmt.initializer.writeAssignStructField(structAFieldY).value.writeLiteralInt(234);
  // }
  // {
  //   const aVar = funcSomethingRet.body.scope.createVariableInScope(CodeTypeSpec.intType, 'a');
  //   const stmt = funcSomethingRet.body.writeVariableDeclaration(aVar);
  //   stmt.initializer.writeExpression().writeLiteralInt(123);
  // }
  // {
  //   const stmt = funcSomethingRet.body.writeReturnStatement();
  //   const op1 = stmt.expr.writeBinaryOperation(CodeBinaryOperator.Add);
  //   const op2 = op1.lhs.writeBinaryOperation(CodeBinaryOperator.Add);
  //   op2.lhs.writeLiteralInt(1);
  //   op2.rhs.writeLiteralInt(2);
  //   op1.rhs.writeLiteralInt(3);
  // }

  // console.log(writer.getOuterCode());



  // ts.sys = new CodeSystem();
  const compilerHost = new MemoryCompilerHost(new Map<string, string>([
    [ 'test.ts', code ],
    [ 'default.d.ts', libCode ],
  ]));
  // const root = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest);
  // console.log(root);
  const program = ts.createProgram(['test.ts'], {}, compilerHost);
  // const tc = program.getTypeChecker();
  // console.log(program);
  const root = program.getSourceFile('test.ts')!;

  new BopProcessor(program, root);
  // const rootExpr = visitNodeRec(root)!;
  // console.log(rootExpr);
}




// TODO FIX!!! Have webpack copy the file to a place we can fetch it.
const libCode = `

interface boolean2 {}
interface boolean3 {}
interface boolean4 {}
interface int { isInt: true }
interface int2 {}
interface int3 {}
interface int4 {}
interface float { isFloat: true }
interface float2 {}
interface float3 {}
interface float4 {}

interface Vector2Constructor<TVector, TElement> {
  // new (): TVector;
  // new (value: TElement): TVector;
  new (x: TElement, y: TElement): TVector;
  // new (xy: Swizzlable2<TElement>): TVector;
  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean2: Vector2Constructor<boolean2, boolean>;
declare var int2: Vector2Constructor<int2, int>;
declare var float2: Vector2Constructor<float2, float>;

interface Vector3Constructor<TVector, TElement> {
  // new (): TVector;
  // new (value: TElement): TVector;
  new (x: TElement, y: TElement, z: TElement): TVector;
  // new (x: TElement, yz: Swizzlable2<TElement>): TVector;
  // new (xy: Swizzlable2<TElement>, z: TElement): TVector;
  // new (xyz: Swizzlable3<TElement>): TVector;
  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean3: Vector3Constructor<boolean3, boolean>;
declare var int3: Vector3Constructor<int3, int>;
declare var float3: Vector3Constructor<float3, float>;

interface Vector4Constructor<TVector, TElement> {
  // new (): TVector;
  // new (value: TElement): TVector;
  new (x: TElement, y: TElement, z: TElement, w: TElement): TVector;
  // new (x: TElement, y: TElement, zw: Swizzlable2<TElement>): TVector;
  // new (x: TElement, yz: Swizzlable2<TElement>, w: TElement): TVector;
  // new (xy: Swizzlable2<TElement>, z: TElement, w: TElement): TVector;
  // new (xy: Swizzlable2<TElement>, zw: Swizzlable2<TElement>): TVector;
  // new (x: TElement, yzw: Swizzlable3<TElement>): TVector;
  // new (xyz: Swizzlable3<TElement>, w: TElement): TVector;
  // new (xyzw: Swizzlable4<TElement>): TVector;

  readonly zero: TVector;
  readonly one: TVector;
}
declare var boolean4: Vector4Constructor<boolean4, boolean>;
declare var int4: Vector4Constructor<int4, int>;
declare var float4: Vector4Constructor<float4, float>;





interface Swizzlable2<T> {
  x: T;
  y: T;
  xy: Swizzlable2<T>;
  yx: Swizzlable2<T>;
}
interface boolean2 extends Swizzlable2<boolean> {}
interface int2 extends Swizzlable2<int> {}
interface float2 extends Swizzlable2<float> {}

interface Swizzlable3<T> {
  x: T;
  y: T;
  z: T;
  xy: Swizzlable2<T>;
  xz: Swizzlable2<T>;
  yx: Swizzlable2<T>;
  yz: Swizzlable2<T>;
  zx: Swizzlable2<T>;
  zy: Swizzlable2<T>;
  xyz: Swizzlable3<T>;
  xzy: Swizzlable3<T>;
  yxz: Swizzlable3<T>;
  yzx: Swizzlable3<T>;
  zxy: Swizzlable3<T>;
  zyx: Swizzlable3<T>;
}
interface boolean3 extends Swizzlable3<boolean> {}
interface int3 extends Swizzlable3<int> {}
interface float3 extends Swizzlable3<float> {}

interface Swizzlable4<T> {
  x: T;
  y: T;
  z: T;
  w: T;
  xy: Swizzlable2<T>;
  xz: Swizzlable2<T>;
  xw: Swizzlable2<T>;
  yx: Swizzlable2<T>;
  yz: Swizzlable2<T>;
  yw: Swizzlable2<T>;
  zx: Swizzlable2<T>;
  zy: Swizzlable2<T>;
  zw: Swizzlable2<T>;
  wx: Swizzlable2<T>;
  wy: Swizzlable2<T>;
  wz: Swizzlable2<T>;
  xyz: Swizzlable3<T>;
  xyw: Swizzlable3<T>;
  xzy: Swizzlable3<T>;
  xzw: Swizzlable3<T>;
  xwy: Swizzlable3<T>;
  xwz: Swizzlable3<T>;
  yxz: Swizzlable3<T>;
  yxw: Swizzlable3<T>;
  yzx: Swizzlable3<T>;
  yzw: Swizzlable3<T>;
  ywx: Swizzlable3<T>;
  ywz: Swizzlable3<T>;
  zxy: Swizzlable3<T>;
  zxw: Swizzlable3<T>;
  zyx: Swizzlable3<T>;
  zyw: Swizzlable3<T>;
  zwx: Swizzlable3<T>;
  zwy: Swizzlable3<T>;
  wxy: Swizzlable3<T>;
  wxz: Swizzlable3<T>;
  wyx: Swizzlable3<T>;
  wyz: Swizzlable3<T>;
  wzx: Swizzlable3<T>;
  wzy: Swizzlable3<T>;
  xyzw: Swizzlable4<T>;
  xywz: Swizzlable4<T>;
  xzyw: Swizzlable4<T>;
  xzwy: Swizzlable4<T>;
  xwyz: Swizzlable4<T>;
  xwzy: Swizzlable4<T>;
  yxzw: Swizzlable4<T>;
  yxwz: Swizzlable4<T>;
  yzxw: Swizzlable4<T>;
  yzwx: Swizzlable4<T>;
  ywxz: Swizzlable4<T>;
  ywzx: Swizzlable4<T>;
  zxyw: Swizzlable4<T>;
  zxwy: Swizzlable4<T>;
  zyxw: Swizzlable4<T>;
  zywx: Swizzlable4<T>;
  zwxy: Swizzlable4<T>;
  zwyx: Swizzlable4<T>;
  wxyz: Swizzlable4<T>;
  wxzy: Swizzlable4<T>;
  wyxz: Swizzlable4<T>;
  wyzx: Swizzlable4<T>;
  wzxy: Swizzlable4<T>;
  wzyx: Swizzlable4<T>;
}
interface boolean4 extends Swizzlable4<boolean> {}
interface int4 extends Swizzlable4<int> {}
interface float4 extends Swizzlable4<float> {}



interface AtomicCounter {
  relaxedGet(): int;
  relaxedGetAndIncrement(): int;
  relaxedGetAndIncrement(delta: int): int;
}
interface AtomicCounterConstructor {
  new (): AtomicCounter;
  new (initialValue: int): AtomicCounter;
}
declare var AtomicCounter: AtomicCounterConstructor;


interface Texture {
  width: int;
  height: int;
  size: int2;
  channels: int;

  fill(color: float4);
  syncToGpu();

  sample<TCoordMode extends CoordMode, TFilterMode extends FilterMode, TAddressMode extends AddressMode>(
      uv: float2): float4;
}
interface TextureConstructor {
  new (width: int, height: int, channels: int = 4): Texture;
  new (size: int2, channels: int = 4): Texture;
}
declare var Texture: TextureConstructor;


interface CoordMode { coordMode: 0|1; }
interface NormalizedCoordMode extends CoordMode { coordMode: 0; }
interface PixelCoordMode extends CoordMode { coordMode: 1; }

interface FilterMode { filterMode: 0|1|2; }
interface NearestFilterMode { filterMode: 0; }
interface LinearFilterMode { filterMode: 1; }
interface BicubicFilterMode { filterMode: 2; }

interface AddressMode { addressMode: 0|1|2|3|4; }
interface ClampToZeroAddressMode { addressMode: 0; }
interface ClampToEdgeAddressMode { addressMode: 1; }
interface RepeatAddressMode { addressMode: 2; }
interface MirroredRepeatAddressMode { addressMode: 3; }
interface ClampToBorderAddressMode { addressMode: 4; }



interface Array<T> {
  [n: int]: T;
  length: int;

  push(value: T): void;

  readonly isGpuBufferDirty: boolean;
  readonly isCpuBufferDirty: boolean;

  syncToGpu();
  syncToCpu();
}
interface ArrayConstructor {
  new <T>(): Array<T>;
  new <T>(length: int): Array<T>;
  new <T>(length: int, fill: T): Array<T>;

  persistent<T>(length: int): Array<T>;
}
declare var Array: ArrayConstructor;


interface RelativeIndexable<T> {
  at(index: int): T | undefined;
}
interface Array<T> extends RelativeIndexable<T> {}





















type VarArgs = readonly unknown[];



type ThreadId1d = int;
interface ThreadId2d {
  xy: int2;
}
interface ThreadId2dNormalized {
  xy: float2;
}
type ThreadId = ThreadId2dNormalized|ThreadId2d|ThreadId1d;


type CompiledComputePipeline<TExtraKernelArgs extends VarArgs> = (...tailArgs: TExtraKernelArgs);
type CompiledMapperComputePipeline<TInput, TOutput, TExtraKernelArgs extends VarArgs> = (inputs: TInput[], ...tailArgs: TExtraKernelArgs) => TOutput[];
type CompiledTexturePipeline<TExtraKernelArgs extends VarArgs> = (...tailArgs: TExtraKernelArgs) => Texture;

type CompiledFragmentStage<TExtraFragmentShaderArgs extends VarArgs> = (...args: TExtraFragmentShaderArgs) => float4;
type CompiledRenderPipeline<TVertex, TExtraVertexShaderArgs extends VarArgs, TExtraFragmentShaderArgs extends VarArgs> = (vertices: TVertex[], ...args: TExtraVertexShaderArgs) => CompiledFragmentStage<TExtraFragmentShaderArgs>;

interface Gpu {}
interface GpuStatic {
  compute<TExtraKernelArgs extends VarArgs>(
      kernel: (threadId: ThreadId1d, ...args: [...TExtraKernelArgs]) => void,
      options: { gridFromSize?: int, gridFromArray?: unknown[] },
  ): CompiledComputePipeline<TExtraKernelArgs>;
  compute<TInput, TOutput, TExtraKernelArgs extends VarArgs>(
      kernel: (input: TInput, threadId: ThreadId1d, ...args: [...TExtraKernelArgs]) => TOutput,
      options: { gridFromArray: unknown[], writeBuffer?: TOutput[] },
  ): CompiledMapperComputePipeline<TInput, TOutput, TExtraKernelArgs>;

  computeTexture<TThreadId extends ThreadId, TExtraKernelArgs extends VarArgs>(
      kernel: (threadId: TThreadId, ...args: [...TExtraKernelArgs]) => float4,
      options: { gridFromTexture: Texture, writeTarget?: Texture },
  ): CompiledTexturePipeline<TExtraKernelArgs>;

  renderElements<TVertex, TSurface, TExtraVertexShaderArgs extends VarArgs, TExtraFragmentShaderArgs extends VarArgs>(
      count: int,
      vertexShader: (vertex: TVertex, threadId: ThreadId1d, ...args: [...TExtraVertexShaderArgs]) => TSurface,
      fragmentShader: (surface: TSurface, threadId: ThreadId1d, ...args: [...TExtraFragmentShaderArgs]) => float4,
      options?: { blendMode?: int, writeTarget?: Texture },
  ): CompiledRenderPipeline<TVertex, TExtraVertexShaderArgs, TExtraFragmentShaderArgs>;
}
declare var Gpu: GpuStatic;



`;




















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
    console.log(`readFile ${fileName}`);
    return true;
  }
  readFile(fileName: string): string | undefined {
    console.log(`readFile ${fileName}`);
    return '';
  }
  // trace?(s: string): void;
  // directoryExists?(directoryName: string): boolean;
  // realpath?(path: string): string;
  // getCurrentDirectory?(): string;
  // getDirectories?(path: string): string[];
  // useCaseSensitiveFileNames?: boolean | (() => boolean) | undefined;

  getSourceFile(fileName: string, languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined {
    console.log(`getSourceFile ${fileName}: shouldCreateNewSourceFile: ${shouldCreateNewSourceFile}`);
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









