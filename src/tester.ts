
// type VarArgs = readonly unknown[];



// type ThreadId1d = int;
// interface ThreadId2d {
//   xy: int2;
// }
// interface ThreadId2dNormalized {
//   xy: float2;
// }
// type ThreadId = ThreadId2dNormalized|ThreadId2d|ThreadId1d;


// type CompiledComputePipeline<TExtraKernelArgs extends VarArgs> = (...tailArgs: TExtraKernelArgs);
// type CompiledMapperComputePipeline<TInput, TOutput, TExtraKernelArgs extends VarArgs> = (inputs: TInput[], ...tailArgs: TExtraKernelArgs) => TOutput[];

// function compute<TExtraKernelArgs extends VarArgs>(
//     kernel: (threadId: ThreadId1d, ...args: [...TExtraKernelArgs]) => void,
//     options: { gridFromSize?: int, gridFromArray?: unknown[] },
// ): CompiledComputePipeline<TExtraKernelArgs>;
// function compute<TInput, TOutput, TExtraKernelArgs extends VarArgs>(
//     kernel: (input: TInput, threadId: ThreadId1d, ...args: [...TExtraKernelArgs]) => TOutput,
//     options: { gridFromArray: unknown[], writeBuffer?: TOutput[] },
// ): CompiledMapperComputePipeline<TInput, TOutput, TExtraKernelArgs> {
//   return null as any;
// }

// type CompiledTexturePipeline<TExtraKernelArgs extends VarArgs> = (...tailArgs: TExtraKernelArgs) => Texture;

// function computeTexture<TThreadId extends ThreadId, TExtraKernelArgs extends VarArgs>(
//     kernel: (threadId: TThreadId, ...args: [...TExtraKernelArgs]) => float4,
//     options: { gridFromTexture: Texture, writeTarget?: Texture },
// ): CompiledTexturePipeline<TExtraKernelArgs> {
//   return null as any;
// }

// type CompiledFragmentStage<TExtraFragmentShaderArgs extends VarArgs> = (...args: TExtraFragmentShaderArgs) => float4;
// type CompiledRenderPipeline<TVertex, TExtraVertexShaderArgs extends VarArgs, TExtraFragmentShaderArgs extends VarArgs> = (vertices: TVertex[], ...args: TExtraVertexShaderArgs) => CompiledFragmentStage<TExtraFragmentShaderArgs>;

// function renderElements<TVertex, TSurface, TExtraVertexShaderArgs extends VarArgs, TExtraFragmentShaderArgs extends VarArgs>(
//     count: int,
//     vertexShader: (vertex: TVertex, threadId: ThreadId1d, ...args: [...TExtraVertexShaderArgs]) => TSurface,
//     fragmentShader: (surface: TSurface, threadId: ThreadId1d, ...args: [...TExtraFragmentShaderArgs]) => float4,
//     options?: { blendMode?: int, writeTarget?: Texture },
// ): CompiledRenderPipeline<TVertex, TExtraVertexShaderArgs, TExtraFragmentShaderArgs> {
//   return null as any;
// }

// interface TriangleVertex {
//   /* @position */ position: float2;
//   color: float4;
// }




// function floatIn(options: { min: float, max: float, default: float }): float;
// function readNodeVideoSource(): Texture;
// function allocatePersistentTexture(): Texture;
// function allocatePersistentBuffer<T>(length: int): T[];





// function drawTriangle() {
//   @vertexShader
//   function vertexShader(position: TriangleVertex, threadId: int, options: { placeholder: float }): TriangleVertex {
//     return position;
//   }
//   @fragmentShader
//   function fragmentShader(position: TriangleVertex, threadId: int, options: { alpha: float }): float4 {
//     const color = position.color;
//     color.a = options.alpha;
//     return color;
//   }

//   const positions: TriangleVertex[] = Array.persistent<TriangleVertex>(3);
//   positions.push({ position: new float2(0, 0), color: new float4(0, 0, 1, 1) });
//   positions.push({ position: new float2(1, 0), color: new float4(1, 0, 1, 1) });
//   positions.push({ position: new float2(1, 1), color: new float4(1, 1, 1, 1) });
//   // const positions = generateTriangleVertices(10);

//   renderElements(positions.length, vertexShader, fragmentShader)(positions, { placeholder: 1 })({ alpha: 0.5 });
// }


// interface AtomicInt {
//   getAndIncrement(): int;
// }

// function generateTriangleVertices(count: int): TriangleVertex[] {
//   @kernel
//   function kernel(threadId: int, @readwrite counter: AtomicInt, @readwrite outPositions: TriangleVertex[]) {
//     const index = counter.getAndIncrement();
//     outPositions[index * 3 + 0] = { position: new float2(0, 0), color: new float4(0, 0, 1, 1) };
//     outPositions[index * 3 + 1] = { position: new float2(1, 0), color: new float4(1, 0, 1, 1) };
//     outPositions[index * 3 + 2] = { position: new float2(1, 1), color: new float4(1, 1, 1, 1) };
//   }
//   const counter: AtomicInt = new AtomicInt();
//   const positions: TriangleVertex[] = allocatePersistentBuffer<TriangleVertex>(count * 3);
//   compute(kernel, { gridFromSize: count })(counter, positions);
//   return positions;
// }





// function blur(inTexture: Texture, options: { size: float, quality: float }) {
//   // const outputTexture = allocateTextureTemp({ copyFormat: inTexture });
//   const outputTexture = computeTexture(blurKernel, { gridFromTexture: inTexture })(inTexture, options);
//   return outputTexture;
// }

// @kernel
// function blurKernel(threadId: { xy: int2 }, inTexture: Texture, options: { size: float, quality: float }): float4 {
//   const w = inTexture.width;
//   const h = inTexture.height;
//   const majorLength = Math.max(w, h);
//   const blurSize = Math.floorToInt(options.size * marjorLength);
//   let acc: float4 = 0;
//   for (let y = 0; y < blurSize; ++y) {
//     for (let x = 0; x < blurSize; ++x) {
//       const sample = inTexture.sample<TextureFilter.Bilinear, TextureClamp.ClampToEdge, TextureAddress.Pixel>(thread.xy + new float2(x, y));
//       acc += sample;
//     }
//   }
//   acc /= blurSize * blurSize;
//   return acc;
// }

// function feedback(inTexture: Texture, options: { feedback: float }) {
//   @kernel
//   function kernel(thread: { xy: int2 }, inTexture: Texture, /*@writable*/ historyTexture: Texture, options: { feedback: float }): float4 {
//     const inSample = inTexture.sample(thread.xy);
//     const historySample = historyTexture.sample(thread.xy);
//     const newSample = Math.lerp(inSample, historySample, options.feedback);
//     // historyTexture.write(thread.xy, newSample);
//     return newSample;
//   }
//   const writeTexture = allocatePersistentTexture({ copyFormat: inTexture });
//   // Warning! Texture aliasing!
//   return computeTexture(kernel, { gridFromTexture: inTexture, writeTarget: writeTexture })(inTexture, writeTexture, options);
// }





// const trackA = {
//   // @node({ memoize: 'frame' })
//   blurSize(): float {
//     return floatIn({ min: 0.0, max: 1.0, default: 0.5 });
//   },
// };


// const trackB = {
//   // @node({ memoize: 'frame' })
//   videoSource(): Texture {
//     // ???
//     return readNodeVideoSource();
//   },

//   // @node({ memoize: 'frame' })
//   blurQuality(): float {
//     return floatIn({ min: 0.0, max: 1.0, default: 0.5 });
//   },

//   // @node({ memoize: 'frame' })
//   blur() {
//     const inTexture = trackB.videoSource();
//     const blurSize = trackA.blurSize();
//     const blurQuality = trackB.blurQuality();
//     return blur(inTexture, { size: blurSize, quality: blurQuality });
//   },

//   // @node({ memoize: 'frame' })
//   feedback() {
//     const inTexture = trackB.blur();
//     return feedback(inTexture, { feedback: 0.9 });
//   },
// };



// @track
// function runMain() {
//   return trackB.feedback();
// }






