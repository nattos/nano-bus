import * as utils from '../utils';
import { WGSL_LIB_CODE } from './bop-wgsl-lib';




class BopClass {
  readonly fields?: Record<string, BopClass>;
  marshalByteStride?: number;
  marshalBytesInto?(value: any, into: BufferFiller, indexOffset: number): void;
}

const BopLib = {
  int: {
    cast(x: number): number {
      return x;
    },
  },
  float: {
    cast(x: number): number {
      return x;
    },
  },
  float4: {
    get fields() { return BopFloat4.fields; },
    constructor(x?: number, y?: number, z?: number, w?: number): BopFloat4 {
      if (x !== undefined && y === undefined) {
        return new BopFloat4(x, x, x, x);
      }
      return new BopFloat4(x ?? 0.0, y ?? 0.0, z ?? 0.0, w ?? 0.0);
    },
    get_x(self: BopFloat4) { return self.x; },
    get_y(self: BopFloat4) { return self.y; },
    get_z(self: BopFloat4) { return self.z; },
    get_w(self: BopFloat4) { return self.w; },
    set_x(self: BopFloat4, v: number) { self.x = v; },
    set_y(self: BopFloat4, v: number) { self.y = v; },
    set_z(self: BopFloat4, v: number) { self.z = v; },
    set_w(self: BopFloat4, v: number) { self.w = v; },

    operatorAdd(lhs: BopFloat4|number, rhs: BopFloat4|number) {
      if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
        if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
          return this.constructor(lhs + rhs.x, lhs + rhs.y, lhs + rhs.z, lhs + rhs.w);
        } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
          return this.constructor(lhs.x + rhs, lhs.y + rhs, lhs.z + rhs, lhs.w + rhs);
        } else {
          throw new Error();
        }
      }
      return this.constructor(lhs.x + rhs.x, lhs.y + rhs.y, lhs.z + rhs.z, lhs.w + rhs.w);
    },
    operatorSubtract(lhs: BopFloat4|number, rhs: BopFloat4|number) {
      if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
        if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
          return this.constructor(lhs - rhs.x, lhs - rhs.y, lhs - rhs.z, lhs - rhs.w);
        } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
          return this.constructor(lhs.x - rhs, lhs.y - rhs, lhs.z - rhs, lhs.w - rhs);
        } else {
          throw new Error();
        }
      }
      return this.constructor(lhs.x - rhs.x, lhs.y - rhs.y, lhs.z - rhs.z, lhs.w - rhs.w);
    },
    operatorMultiply(lhs: BopFloat4|number, rhs: BopFloat4|number) {
      if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
        if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
          return this.constructor(lhs * rhs.x, lhs * rhs.y, lhs * rhs.z, lhs * rhs.w);
        } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
          return this.constructor(lhs.x * rhs, lhs.y * rhs, lhs.z * rhs, lhs.w * rhs);
        } else {
          throw new Error();
        }
      }
      return this.constructor(lhs.x * rhs.x, lhs.y * rhs.y, lhs.z * rhs.z, lhs.w * rhs.w);
    },
    operatorDivide(lhs: BopFloat4|number, rhs: BopFloat4|number) {
      if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
        if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
          return this.constructor(lhs / rhs.x, lhs / rhs.y, lhs / rhs.z, lhs / rhs.w);
        } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
          return this.constructor(lhs.x / rhs, lhs.y / rhs, lhs.z / rhs, lhs.w / rhs);
        } else {
          throw new Error();
        }
      }
      return this.constructor(lhs.x / rhs.x, lhs.y / rhs.y, lhs.z / rhs.z, lhs.w / rhs.w);
    },
    operatorNegate(lhs: BopFloat4) {
      return this.constructor(-lhs.x, -lhs.y, -lhs.z, -lhs.w);
    },
  },
  Array: {
    persistent<T>(elementType: BopClass|undefined, l: number): BopArray<T> {
      return new BopArray<T>(elementType, l);
    },
  },
};

class BopFloat4 {
  static readonly fields = {
    x: BopLib.float,
    y: BopLib.float,
    z: BopLib.float,
    w: BopLib.float,
  };

  constructor(
    public x: number,
    public y: number,
    public z: number,
    public w: number,
  ) {}
}

class BopArrayImpl<T> {
  readonly buffer: T[];
  length: number = 0;

  private cpuDirty = false;
  private gpuDirty = false;
  private gpuBuffer?: GPUBuffer;
  private gpuVertexDirty = false;
  private gpuVertexBuffer?: GPUBuffer;

  constructor(readonly elementType: BopClass|undefined, capacity: number) {
    this.buffer = new Array<T>(capacity);
    for (let i = 0; i < capacity; ++i) {
      const value: T = new (elementType as any)();
      this.buffer[i] = value;
    }
    this.length = capacity;
  }

  at(i: number) {
    return this.buffer[i];
  }
  set(i: number, value: T) {
    if (i >= this.length) {
      for (let insertIndex = this.length; insertIndex < i; ++insertIndex) {
        this.buffer[insertIndex] = new (this.elementType as any)();
      }
      this.length = i + 1;
    }
    this.buffer[i] = value;
    this.markCpuWrite();
  }
  push(v: T) {
    this.buffer[this.length++] = v;
    this.markCpuWrite();
  }

  markCpuWrite() {
    this.gpuDirty = true;
  }
  markGpuWrite() {
    this.cpuDirty = true;
  }
  getGpuBuffer(): GPUBuffer|undefined {
    return this.gpuBuffer;
  }
  getGpuVertexBuffer(): GPUBuffer|undefined {
    return this.gpuVertexBuffer;
  }
  ensureGpuBuffer() {
    const stride = this.elementType?.marshalByteStride;
    const marshalFunc = this.elementType?.marshalBytesInto;
    const device = SharedMTLInternals().device;
    if (stride === undefined || marshalFunc === undefined || !device) {
      return;
    }
    const count = this.length;
    const byteLength = stride * count;

    let gpuDirty = this.gpuDirty;
    if (this.gpuBuffer === undefined || this.gpuBuffer.size < byteLength) {
      console.log("device.createBuffer");
      this.gpuBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.UNIFORM
      });
      gpuDirty = true;
    }
    if (gpuDirty) {
      this.gpuDirty = false;
      this.gpuVertexDirty = true;

      const bufferFiller = new BufferFiller(byteLength);
      for (let i = 0; i < count; ++i) {
        marshalFunc(this.buffer[i], bufferFiller, i);
      }
      device.queue.writeBuffer(this.gpuBuffer, 0, bufferFiller.getBuffer(), 0, byteLength);
      console.log("ensureGpuBuffer", "device.queue.writeBuffer(this.gpuBuffer, 0, bufferFiller.getBuffer(), 0, byteLength);");
    }
  }
  ensureGpuVertexBuffer(commandEncoder: GPUCommandEncoder) {
    this.ensureGpuBuffer();
    const gpuBuffer = this.gpuBuffer;
    const device = SharedMTLInternals().device;
    if (!device || !gpuBuffer) {
      return;
    }
    const byteLength = gpuBuffer.size;

    let gpuDirty = this.gpuVertexDirty;
    if (this.gpuVertexBuffer === undefined || this.gpuVertexBuffer.size < byteLength) {
      this.gpuVertexBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      gpuDirty = true;
    }
    if (gpuDirty) {
      this.gpuVertexDirty = false;
      commandEncoder.copyBufferToBuffer(gpuBuffer, 0, this.gpuVertexBuffer, 0, byteLength);
      console.log("ensureGpuVertexBuffer", "commandEncoder.copyBufferToBuffer(gpuBuffer, 0, this.gpuVertexBuffer, 0, byteLength);");
    }
  }
}

class BopArray<T> {
  constructor(readonly elementType: BopClass|undefined, readonly capacity: number) {
    const impl = new BopArrayImpl<T>(elementType, capacity);
    const implPrototype = BopArrayImpl.prototype;
    for (const k of Object.getOwnPropertyNames(implPrototype)) {
      const v = (implPrototype as any)[k];
      if (typeof v === 'function') {
        (impl as any)[k] = v.bind(impl);
      }
    }

    const getImpl = () => impl;

    return new Proxy(this, {
      set(target, p, newValue, receiver) {
        const rawValue = Reflect.get(impl, p, receiver);
        if (typeof(p) !== 'string' || rawValue !== undefined) {
          return Reflect.set(impl, p, newValue, receiver);
        }
        impl.set(parseInt(p), newValue);
        return true;
      },
      get(target, p, receiver) {
        const rawValue = Reflect.get(impl, p, receiver);
        if (typeof(p) !== 'string' || rawValue !== undefined) {
          return rawValue;
        }
        if (p === 'getImpl') {
          return getImpl;
        }
        return impl.at(parseInt(p));
      },
    });
  }

  getImpl(): BopArrayImpl<T> { throw new Error('never'); }

  static push<T>(a: Array<T>, v: T) { a.push(v); }
  static get_length<T>(a: Array<T>) { return a.length; }
};





export class BufferFiller {
  arrayBuffer;
  float32Buffer;
  int32Buffer;

  constructor(readonly byteLength: number) {
    this.arrayBuffer = new ArrayBuffer(byteLength);
    this.float32Buffer = new Float32Array(this.arrayBuffer);
    this.int32Buffer = new Float32Array(this.arrayBuffer);
  }

  writeFloat(offset: number, value: number) {
    this.float32Buffer[offset >> 2] = value;
  }
  writeInt(offset: number, value: number) {
    this.int32Buffer[offset >> 2] = value;
  }
  getBuffer() {
    return this.arrayBuffer;
  }
}





export class MTLInternals {
  readonly ready;
  readonly shadersReady;
  readonly targetReady;
  readonly globalEncoderQueue = new utils.OperationQueue();

  get device() { return this._device; }
  private _device?: GPUDevice;

  private readonly shaderCodeProvider = new utils.Resolvable<string>();
  private readonly targetCanvasContextProvider = new utils.Resolvable<GPUCanvasContext>();

  constructor() {
    const ready = this.ready = (async () => {
      const adapter = await navigator.gpu.requestAdapter() ?? undefined;
      const device = await adapter?.requestDevice();
      this._device = device;
      if (!adapter || !device) {
        console.log('WebGPU initialization failed.');
      }
      return { adapter, device };
    })();
    const shadersReady = this.shadersReady = (async () => {
      const { device } = await ready;
      const code = await this.shaderCodeProvider.promise;

      const shaderModule = device?.createShaderModule({
        code: code + WGSL_LIB_CODE,
      });
      const compilationInfo = await shaderModule?.getCompilationInfo();
      if ((compilationInfo?.messages.length ?? 0) > 0) {
        console.log(compilationInfo?.messages.map(m => `${m.lineNum}:${m.linePos} ${m.type}: ${m.message}`).join('\n'));
      }
      return { shaderModule };
    })();
    this.targetReady = (async () => {
      const { device } = await ready;
      const context = await this.targetCanvasContextProvider.promise;

      if (device) {
        context.configure({
          device: device,
          format: navigator.gpu.getPreferredCanvasFormat(),
          alphaMode: 'premultiplied',
        });
      }
      const targetTextureViewFunc = () => context.getCurrentTexture().createView();
      return { targetTextureViewFunc };
    })();
  }

  loadShaderCode(code: string) {
    this.shaderCodeProvider.resolve(code);
  }
  setTargetCanvasContext(context: GPUCanvasContext) {
    this.targetCanvasContextProvider.resolve(context);
  }
}

export const SharedMTLInternals = utils.lazy(() => new MTLInternals());






interface Texture {
}

function AllocatePersistentTexture(format: unknown, salt: number): Texture {
  return {};
}

function GetTrackTextureFormat(): unknown {
  return {};
}








class MTLFunction {
  readonly ready;

  constructor(readonly functionName: string) {
    this.ready = (async () => {
      const internals = SharedMTLInternals();
      const { shaderModule } = await internals.shadersReady;
    })();
  }
}

const InvalidMTLFunction = utils.lazy(() => new MTLFunction('InvalidMTLFunction'));

function MTLLibraryNewFunctionWithName(functionName: string): MTLFunction {
  return new MTLFunction(functionName);
}


class MTLRenderPipelineDescriptor {
  label = 'Unknown Pipeline';
  vertexFunction = InvalidMTLFunction();
  fragmentFunction = InvalidMTLFunction();
  colorAttachments: MTLRenderPipelineColorAttachmentDescriptor[] = [
    {
      pixelFormat: MTLPixelFormat.MTLPixelFormatBGRA8Unorm_sRGB,
      blendingEnabled: false,
      alphaBlendOperation: MTLBlendOperation.MTLBlendOperationAdd,
      rgbBlendOperation: MTLBlendOperation.MTLBlendOperationAdd,
      destinationAlphaBlendFactor: MTLBlendFactor.MTLBlendFactorZero,
      destinationRGBBlendFactor: MTLBlendFactor.MTLBlendFactorZero,
      sourceAlphaBlendFactor: MTLBlendFactor.MTLBlendFactorOne,
      sourceRGBBlendFactor: MTLBlendFactor.MTLBlendFactorOne,
    },
  ];

  readonly ready;
  private compileFlag = new utils.Resolvable();

  constructor(label?: string) {
    this.label = label ?? this.label;
    this.ready = (async (): Promise<{ renderPipeline?: GPURenderPipeline }> => {
      await this.compileFlag.promise;
      const internals = SharedMTLInternals();
      const { device } = await internals.ready;
      const { shaderModule } = await internals.shadersReady;
      if (!device || !shaderModule) {
        return { renderPipeline: undefined };
      }

      await this.vertexFunction.ready;
      await this.fragmentFunction.ready;

      const vertexBuffers: GPUVertexBufferLayout[] = [
        {
          attributes: [
            {
              shaderLocation: 0, // position
              offset: 0,
              format: 'float32x4',
            },
            {
              shaderLocation: 1, // color
              offset: 16,
              format: 'float32x4',
            },
          ],
          arrayStride: 32,
          stepMode: 'vertex',
        },
      ];
      const pipelineDescriptor: GPURenderPipelineDescriptor = {
        vertex: {
          module: shaderModule,
          entryPoint: this.vertexFunction.functionName,
          buffers: vertexBuffers,
        },
        fragment: {
          module: shaderModule,
          entryPoint: this.fragmentFunction.functionName,
          targets: [
            {
              format: navigator.gpu.getPreferredCanvasFormat(),
            },
          ],
        },
        primitive: {
          topology: 'triangle-list',
        },
        layout: 'auto',
      };
      const renderPipeline = await device.createRenderPipelineAsync(pipelineDescriptor);
      return { renderPipeline };
    })();
  }

  compile() { this.compileFlag.resolve(undefined); }
}

const InvalidMTLRenderPipelineDescriptor = utils.lazy(() => new MTLRenderPipelineDescriptor('InvalidMTLRenderPipelineDescriptor'));

interface MTLRenderPipelineColorAttachmentDescriptor {
  pixelFormat: MTLPixelFormat;
  blendingEnabled: boolean;
  alphaBlendOperation: MTLBlendOperation;
  rgbBlendOperation: MTLBlendOperation;
  destinationAlphaBlendFactor: MTLBlendFactor;
  destinationRGBBlendFactor: MTLBlendFactor;
  sourceAlphaBlendFactor: MTLBlendFactor;
  sourceRGBBlendFactor: MTLBlendFactor;
}

export enum MTLPixelFormat {
  MTLPixelFormatBGRA8Unorm_sRGB = 'MTLPixelFormatBGRA8Unorm_sRGB',
}

export enum MTLBlendOperation {
  MTLBlendOperationAdd = 'MTLBlendOperationAdd',
  MTLBlendOperationSubtract = 'MTLBlendOperationSubtract',
  MTLBlendOperationReverseSubtract = 'MTLBlendOperationReverseSubtract',
  MTLBlendOperationMin = 'MTLBlendOperationMin',
  MTLBlendOperationMax = 'MTLBlendOperationMax',
}

export enum MTLBlendFactor {
  MTLBlendFactorZero = 'MTLBlendFactorZero',
  MTLBlendFactorOne = 'MTLBlendFactorOne',
  MTLBlendFactorSourceColor = 'MTLBlendFactorSourceColor',
  MTLBlendFactorOneMinusSourceColor = 'MTLBlendFactorOneMinusSourceColor',
  MTLBlendFactorSourceAlpha = 'MTLBlendFactorSourceAlpha',
  MTLBlendFactorOneMinusSourceAlpha = 'MTLBlendFactorOneMinusSourceAlpha',
  MTLBlendFactorDestinationColor = 'MTLBlendFactorDestinationColor',
  MTLBlendFactorOneMinusDestinationColor = 'MTLBlendFactorOneMinusDestinationColor',
  MTLBlendFactorDestinationAlpha = 'MTLBlendFactorDestinationAlpha',
  MTLBlendFactorOneMinusDestinationAlpha = 'MTLBlendFactorOneMinusDestinationAlpha',
  MTLBlendFactorSourceAlphaSaturated = 'MTLBlendFactorSourceAlphaSaturated',
  MTLBlendFactorBlendColor = 'MTLBlendFactorBlendColor',
  MTLBlendFactorOneMinusBlendColor = 'MTLBlendFactorOneMinusBlendColor',
  MTLBlendFactorBlendAlpha = 'MTLBlendFactorBlendAlpha',
  MTLBlendFactorOneMinusBlendAlpha = 'MTLBlendFactorOneMinusBlendAlpha',
  MTLBlendFactorSource1Color = 'MTLBlendFactorSource1Color',
  MTLBlendFactorOneMinusSource1Color = 'MTLBlendFactorOneMinusSource1Color',
  MTLBlendFactorSource1Alpha = 'MTLBlendFactorSource1Alpha',
  MTLBlendFactorOneMinusSource1Alpha = 'MTLBlendFactorOneMinusSource1Alpha',
}

function MakeMTLRenderPipelineDescriptor(): MTLRenderPipelineDescriptor {
  return new MTLRenderPipelineDescriptor('Unknown Pipeline');
}

interface MTLRenderPassDescriptor {
  colorAttachments: MTLRenderPassColorAttachmentDescriptor[];
}

interface MTLRenderPassColorAttachmentDescriptor extends MTLRenderPassAttachmentDescriptor {
  clearColor: BopFloat4;
}

interface MTLRenderPassAttachmentDescriptor {
  texture: MTLTexture;
  loadAction: MTLLoadAction;
  storeAction: MTLStoreAction;
}

export enum MTLLoadAction {
  MTLLoadActionClear = 'MTLLoadActionClear',
}

export enum MTLStoreAction {
  MTLStoreActionStore = 'MTLStoreActionStore',
}

function MakeMTLRenderPassDescriptor(): MTLRenderPassDescriptor {
  return {
    colorAttachments: [
      {
        clearColor: MTLClearColorMake(0, 0, 0, 0),
        texture: InvalidMTLTexture,
        loadAction: MTLLoadAction.MTLLoadActionClear,
        storeAction: MTLStoreAction.MTLStoreActionStore,
      },
    ],
  }
}

interface MTLRenderPipelineState {
  descriptor: MTLRenderPipelineDescriptor;
}

const InvalidMTLRenderPipelineState = utils.lazy(() => utils.upcast<MTLRenderPipelineState>({
  descriptor: InvalidMTLRenderPipelineDescriptor(),
}));

function MTLNewRenderPipelineStateWithDescriptor(descriptor: MTLRenderPipelineDescriptor): MTLRenderPipelineState {
  return {
    descriptor: descriptor,
  };
}







class MTLComputePipelineDescriptor {
  label = 'Unknown Pipeline';
  computeFunction = InvalidMTLFunction();

  readonly ready;
  private compileFlag = new utils.Resolvable();

  constructor(label?: string) {
    this.label = label ?? this.label;
    this.ready = (async (): Promise<{ pipeline?: GPUComputePipeline }> => {
      await this.compileFlag.promise;
      const internals = SharedMTLInternals();
      const { device } = await internals.ready;
      const { shaderModule } = await internals.shadersReady;
      if (!device || !shaderModule) {
        return { pipeline: undefined };
      }

      await this.computeFunction.ready;

      const vertexBuffers: GPUVertexBufferLayout[] = [
        {
          attributes: [
            {
              shaderLocation: 0, // position
              offset: 0,
              format: 'float32x4',
            },
            {
              shaderLocation: 1, // color
              offset: 16,
              format: 'float32x4',
            },
          ],
          arrayStride: 32,
          stepMode: 'vertex',
        },
      ];
      const pipelineDescriptor: GPUComputePipelineDescriptor = {
        compute: {
          module: shaderModule,
          entryPoint: this.computeFunction.functionName,
        },
        layout: 'auto',
      };
      const pipeline = await device.createComputePipelineAsync(pipelineDescriptor);
      return { pipeline: pipeline };
    })();
  }

  compile() { this.compileFlag.resolve(undefined); }
}

const InvalidMTLComputePipelineDescriptor = utils.lazy(() => new MTLComputePipelineDescriptor('InvalidMTLComputePipelineDescriptor'));

function MakeMTLComputePipelineDescriptor(): MTLComputePipelineDescriptor {
  return new MTLComputePipelineDescriptor('Unknown Pipeline');
}


interface MTLComputePipelineState {
  descriptor: MTLComputePipelineDescriptor;
}

const InvalidMTLComputePipelineState = utils.lazy(() => utils.upcast<MTLComputePipelineState>({
  descriptor: InvalidMTLComputePipelineDescriptor(),
}));

function MTLNewComputePipelineStateWithDescriptor(descriptor: MTLComputePipelineDescriptor): MTLComputePipelineState {
  return {
    descriptor: descriptor,
  };
}









interface MTLTexture {
}

const InvalidMTLTexture = utils.lazy(() => utils.upcast<MTLTexture>({}));

function MTLClearColorMake(r: number, g: number, b: number, a: number): BopFloat4 {
  return BopLib.float4.constructor(r, g, b, a);
}

function MTLToGpuColor(c: BopFloat4): GPUColor {
  return { r: c.x, g: c.y, b: c.z, a: c.w };
}





class MTLRenderCommandEncoder {
  label = 'Unknown Encoder';
  cullMode = MTLCullMode.MTLCullModeNone;
  renderPipelineState = InvalidMTLRenderPipelineState();

  readonly vertexAttributeBytes: Array<BopArray<unknown>|undefined> = [];
  readonly vertexBytes: Array<ArrayBuffer|BopArray<unknown>|undefined> = [];
  readonly fragmentBytes: Array<ArrayBuffer|BopArray<unknown>|undefined> = [];

  private readonly preready;
  private readonly ready;
  private readonly prequeue = new utils.OperationQueue();
  private readonly queue = new utils.OperationQueue();
  private readonly compileFlag = new utils.Resolvable();
  private readonly finishedEncodingFlag = new utils.WaitableFlag();

  constructor(readonly renderPassDescriptor: MTLRenderPassDescriptor) {
    this.preready = (async () => {
      const internals = SharedMTLInternals();
      await this.compileFlag.promise;
      const { device } = await internals.ready;
      const { targetTextureViewFunc } = await internals.targetReady;
      this.renderPipelineState.descriptor.compile();
      const { renderPipeline } = await this.renderPipelineState.descriptor.ready;

      const acquiredGlobalLock = new utils.Resolvable();
      internals.globalEncoderQueue.push(async () => {
        acquiredGlobalLock.resolve(undefined);
        await this.finishedEncodingFlag.wait();
      });
      await acquiredGlobalLock.promise;
      console.log("MTLRenderCommandEncoder", "acquiredGlobalLock");

      const commandEncoder = device?.createCommandEncoder();
      if (commandEncoder) {
        commandEncoder.label = this.label;
      }

      return { device, commandEncoder, renderPipeline, targetTextureViewFunc };
    })();
    this.ready = (async () => {
      const { device, commandEncoder, renderPipeline, targetTextureViewFunc } = await this!.preready;
      await this.prequeue.push(() => {});

      const clearColor: GPUColor = MTLToGpuColor(this.renderPassDescriptor.colorAttachments[0].clearColor);
      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            clearValue: clearColor,
            loadOp: 'clear',
            storeOp: 'store',
            view: targetTextureViewFunc(),
          },
        ],
      };
      const encoder = commandEncoder?.beginRenderPass(renderPassDescriptor);
      if (encoder) {
        encoder.label = this.label;
      }
      if (renderPipeline) {
        encoder?.setPipeline(renderPipeline);
      }
      return { device, commandEncoder, encoder, renderPipeline };
    })();
    this.prequeue.push(() => this.preready);
    this.queue.push(() => this.ready);
  }

  setVertexAttributeBytes(buffer: BopArray<unknown>, index: number) {
    this.vertexAttributeBytes[index] = buffer;
  }

  setVertexBytes(buffer: ArrayBuffer|BopArray<unknown>, index: number) {
    this.vertexBytes[index] = buffer;
  }

  setFragmentBytes(buffer: ArrayBuffer|BopArray<unknown>, index: number) {
    this.fragmentBytes[index] = buffer;
  }

  queuePretask(runner: (commandEncoder: GPUCommandEncoder, device: GPUDevice, renderPipeline: GPURenderPipeline) => Promise<unknown>) {
    this.compileFlag.resolve(undefined);
    this.prequeue.push(async () => {
      const { device, commandEncoder, renderPipeline } = await this.preready;
      if (!device || !commandEncoder || !renderPipeline) {
        return;
      }
      await runner(commandEncoder, device, renderPipeline);
    });
  }

  queueTask(runner: (encoder: GPURenderPassEncoder, commandEncoder: GPUCommandEncoder, device: GPUDevice, renderPipeline: GPURenderPipeline) => Promise<{ finishedEncoding?: boolean }|undefined|void>) {
    this.compileFlag.resolve(undefined);
    this.queue.push(async () => {
      const { device, commandEncoder, encoder, renderPipeline } = await this.ready;
      if (!device || !encoder || !commandEncoder || !renderPipeline) {
        return;
      }
      const result = await runner(encoder, commandEncoder, device, renderPipeline);
      if (result?.finishedEncoding) {
        this.finishedEncodingFlag.set();
      }
    });
  }
}

class MTLComputeCommandEncoder {
  label = 'Unknown Encoder';
  pipelineState = InvalidMTLComputePipelineState();

  dataBytes: Array<ArrayBuffer|BopArray<unknown>|undefined> = [];

  readonly ready;
  private readonly queue = new utils.OperationQueue();
  private readonly compileFlag = new utils.Resolvable();
  private readonly finishedEncodingFlag = new utils.WaitableFlag();

  constructor() {
    this.ready = (async () => {
      const internals = SharedMTLInternals();
      await this.compileFlag.promise;
      const { device } = await internals.ready;
      this.pipelineState.descriptor.compile();
      const { pipeline } = await this.pipelineState.descriptor.ready;

      const acquiredGlobalLock = new utils.Resolvable();
      internals.globalEncoderQueue.push(async () => {
        acquiredGlobalLock.resolve(undefined);
        await this.finishedEncodingFlag.wait();
      });
      await acquiredGlobalLock.promise;
      console.log("MTLComputeCommandEncoder", "acquiredGlobalLock");

      const commandEncoder = device?.createCommandEncoder();
      if (commandEncoder) {
        commandEncoder.label = this.label;
      }

      const encoder = commandEncoder?.beginComputePass();
      if (encoder) {
        encoder.label = this.label;
      }
      if (pipeline) {
        encoder?.setPipeline(pipeline);
      }
      return { device, commandEncoder, encoder, pipeline };
    })();
    this.queue.push(() => this.ready);
  }

  setBytes(buffer: ArrayBuffer|BopArray<unknown>, index: number) {
    this.dataBytes[index] = buffer;
  }

  queueTask(runner: (encoder: GPUComputePassEncoder, commandEncoder: GPUCommandEncoder, device: GPUDevice, pipeline: GPUComputePipeline) => Promise<{ finishedEncoding?: boolean }|undefined|void>) {
    this.compileFlag.resolve(undefined);
    this.queue.push(async () => {
      const { device, commandEncoder, encoder, pipeline } = await this.ready;
      if (!device || !encoder || !commandEncoder || !pipeline) {
        return;
      }
      const result = await runner(encoder, commandEncoder, device, pipeline);
      if (result?.finishedEncoding) {
        this.finishedEncodingFlag.set();
      }
    });
  }
}

export enum MTLCullMode {
  MTLCullModeNone = 'MTLCullModeNone',
}

export enum MTLPrimitiveType {
  MTLPrimitiveTypeTriangle = 'MTLPrimitiveTypeTriangle',
}



function MakeMTLRenderCommandEncoder(renderPassDescriptor: MTLRenderPassDescriptor): MTLRenderCommandEncoder {
  return new MTLRenderCommandEncoder(renderPassDescriptor);
}
function EncoderSetVertexAttributeBuffer(encoder: MTLRenderCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  console.log('EncoderSetVertexAttributeBuffer', encoder, buffer, offset, index);
  const bufferImpl = buffer.getImpl();
  bufferImpl.ensureGpuBuffer();
  encoder.queuePretask(async (commandEncoder) => {
    bufferImpl.ensureGpuVertexBuffer(commandEncoder);
  });
  encoder.setVertexAttributeBytes(buffer, index);
}

function EncoderSetVertexBytes(encoder: MTLRenderCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  console.log('EncoderSetVertexBytes', encoder, buffer, offset, index);
  encoder.setVertexBytes(buffer, index);
}
function EncoderSetVertexBuffer(encoder: MTLRenderCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  console.log('EncoderSetVertexBuffer', encoder, buffer, offset, index);
  buffer.getImpl().ensureGpuBuffer();
  encoder.setVertexBytes(buffer, index);
}
function EncoderSetFragmentBytes(encoder: MTLRenderCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  console.log('EncoderSetFragmentBytes', encoder, buffer, offset, index);
  encoder.setFragmentBytes(buffer, index);
}
function EncoderSetFragmentBuffer(encoder: MTLRenderCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  console.log('EncoderSetFragmentBuffer', encoder, buffer, offset, index);
  buffer.getImpl().ensureGpuBuffer();
  encoder.setFragmentBytes(buffer, index);
}
function EncoderDrawPrimitives(encoder: MTLRenderCommandEncoder, type: MTLPrimitiveType, offset: number, count: number) {
  console.log('EncodeDrawPrimitives', encoder, type, offset, count);
  const proxyEncoder = encoder;
  encoder.queueTask(async (encoder, commandEncoder, device, renderPipeline) => {
    // Bind vertex attribute buffers.
    for (let index = 0; index < proxyEncoder.vertexAttributeBytes.length; ++index) {
      const buffer = proxyEncoder.vertexAttributeBytes[index]?.getImpl();
      if (!buffer) {
        continue;
      }
      const vertexBuffer = buffer.getGpuVertexBuffer();
      if (!vertexBuffer) {
        continue;
      }
      encoder.setVertexBuffer(index, vertexBuffer);
    }

    // Bind additional vertex and fragment shader buffers.
    const marshalBindGroupEntries = (buffers: Array<ArrayBuffer|BopArray<unknown>|undefined>) => {
      const bindGroupEntries: GPUBindGroupEntry[] = [];
      for (let index = 0; index < buffers.length; ++index) {
        const byteArray = buffers[index];
        let bufferBuffer;
        if (byteArray instanceof BopArray) {
          bufferBuffer = byteArray.getImpl().getGpuBuffer();
          if (!bufferBuffer) {
            console.log("missing!!!", "byteArray.getImpl().getGpuBuffer();");
            continue;
          }
        } else {
          if (!byteArray) {
            continue;
          }
          // TODO: Pool allocate TMP buffer.
          bufferBuffer = device.createBuffer({
            size: byteArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM
          });
          device.queue.writeBuffer(bufferBuffer, 0, byteArray, 0, byteArray.byteLength);
          console.log("EncoderDrawPrimitives", "device.queue.writeBuffer(bufferBuffer, 0, byteArray, 0, byteArray.byteLength);");
        }

        const bindGroupEntry: GPUBindGroupEntry = {
          binding: index,
          resource: {
            buffer: bufferBuffer,
          }
        };
        bindGroupEntries.push(bindGroupEntry);
      }
      return bindGroupEntries;
    };
    const vertexBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: marshalBindGroupEntries(proxyEncoder.vertexBytes),
    });
    const fragmentBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(1),
      entries: marshalBindGroupEntries(proxyEncoder.fragmentBytes),
    });
    encoder.setBindGroup(0, vertexBindGroup);
    encoder.setBindGroup(1, fragmentBindGroup);
    encoder.draw(count);
  });
}



function MakeMTLComputeCommandEncoder(): MTLComputeCommandEncoder {
  return new MTLComputeCommandEncoder();
}
function EncoderSetComputeBytes(encoder: MTLComputeCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  console.log('EncoderSetComputeBytes', encoder, buffer, offset, index);
  encoder.setBytes(buffer, index);
}
function EncoderSetComputeBuffer(encoder: MTLComputeCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  console.log('EncoderSetComputeBuffer', encoder, buffer, offset, index);
  buffer.getImpl().ensureGpuBuffer();
  encoder.setBytes(buffer, index);
}
function EncoderDispatchWorkgroups(encoder: MTLComputeCommandEncoder, count: number) {
  console.log('EncoderDispatchWorkgroups', encoder, count);
  const proxyEncoder = encoder;
  encoder.queueTask(async (encoder, commandEncoder, device, renderPipeline) => {
    const marshalBindGroupEntries = (buffers: Array<ArrayBuffer|BopArray<unknown>|undefined>) => {
      const bindGroupEntries: GPUBindGroupEntry[] = [];
      for (let index = 0; index < buffers.length; ++index) {
        const byteArray = buffers[index];
        let bufferBuffer;
        if (byteArray instanceof BopArray) {
          bufferBuffer = byteArray.getImpl().getGpuBuffer();
          if (!bufferBuffer) {
            console.log("missing!!!", "byteArray.getImpl().getGpuBuffer();");
            continue;
          }
        } else {
          if (!byteArray) {
            continue;
          }
          // TODO: Pool allocate TMP buffer.
          bufferBuffer = device.createBuffer({
            size: byteArray.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM
          });
          device.queue.writeBuffer(bufferBuffer, 0, byteArray, 0, byteArray.byteLength);
          console.log("EncoderDispatchWorkgroups", "device.queue.writeBuffer(bufferBuffer, 0, byteArray, 0, byteArray.byteLength);");
        }

        const bindGroupEntry: GPUBindGroupEntry = {
          binding: index,
          resource: {
            buffer: bufferBuffer,
          }
        };
        bindGroupEntries.push(bindGroupEntry);
      }
      return bindGroupEntries;
    };
    const dataBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: marshalBindGroupEntries(proxyEncoder.dataBytes),
    });
    encoder.setBindGroup(0, dataBindGroup);
    encoder.dispatchWorkgroups(count);
  });
}



function EncoderEndEncoding(encoder: MTLRenderCommandEncoder|MTLComputeCommandEncoder) {
  encoder.queueTask(async (encoder, commandEncoder, device) => {
    encoder.end();
    device.queue.submit([commandEncoder.finish()]);
    return { finishedEncoding: true };
  });
}

async function WaitForInternalsReady() {
  await SharedMTLInternals().ready;
}



let init = false;
let __EVAL = (s: string, frozen?: boolean) => eval(`if (!frozen) { void (__EVAL = ${__EVAL}); } ${s}`);

export function evalJavascriptInContext(code: string) {
  const contextCode: string[] = [];
  if (!init) {
    init = true;
    for (const [k, v] of Object.entries(module.exports)) {
      if (typeof k === 'string' && k.startsWith('MTL') && typeof v === 'object') {
        let isStringString = true;
        for (const [ek, ev] of Object.entries(v as {})) {
          if (typeof ek !== 'string' || typeof ev !== 'string') {
            isStringString = false;
            break;
          }
        }
        const e = v as Record<string, string>;
        for (const [ek, ev] of Object.entries(e)) {
          contextCode.push(`const ${ek} = ${k}.${ek};`);
        }
      }
    }
    const fullContextCode = contextCode.join('\n');
    __EVAL(fullContextCode);
  }
  __EVAL(code);
}
