import * as utils from '../../utils';
import { WGSL_LIB_CODE, WGSL_LIB_PREAMBLE_CODE } from './bop-wgsl-lib';




class BopClass {
  readonly fields?: Record<string, BopClass>;
  marshalByteStride?: number;
  marshalBytesInto?(value: any, into: BufferFiller, indexOffset: number): void;
}


function environmentIsLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

class BopLibDebugOuts {
  viewportStart: number = 0;
  get viewportEnd() {
    return this.viewportStart + this.viewportSize;
  }
  readonly viewportSize = 256;
  private readonly littleEndian = environmentIsLittleEndian();
  private bytesBuffer = new ArrayBuffer(this.viewportSize * 4 * 5);
  private dataView = new DataView(this.bytesBuffer);
  private intView = new Int32Array(this.bytesBuffer);

  write(lineNumber: number, length: number, v0: number, v1: number, v2: number, v3: number) {
    if (lineNumber < this.viewportStart || lineNumber >= this.viewportEnd) {
      return;
    }
    const offset = lineNumber * 5;
    this.dataView.setInt32((offset + 0) * 4, length, this.littleEndian);
    this.dataView.setFloat32((offset + 1) * 4, v0, this.littleEndian);
    this.dataView.setFloat32((offset + 2) * 4, v1, this.littleEndian);
    this.dataView.setFloat32((offset + 3) * 4, v2, this.littleEndian);
    this.dataView.setFloat32((offset + 4) * 4, v3, this.littleEndian);
  }

  clear() {
    this.intView.fill(0);
  }

  get(lineNumber: number): { values: number[] }|undefined {
    if (lineNumber < this.viewportStart || lineNumber >= this.viewportEnd) {
      return;
    }
    const offset = lineNumber * 5;
    const length = Math.min(4, this.dataView.getInt32((offset + 0) * 4, this.littleEndian));
    const values: number[] = [];
    for (let i = 0; i < length; ++i) {
      values.push(this.dataView.getFloat32((offset + i + 1) * 4, this.littleEndian));
    }
    return {
      values: values,
    };
  }

  merge(startLineNumber: number, marshaledBytes: ArrayBuffer) {
    const inViewportSize = marshaledBytes.byteLength / 4 / 5;
    const thisViewportSize = this.viewportSize;

    const viewportSize = Math.min(inViewportSize, thisViewportSize);

    const inViewportStart = startLineNumber;
    const inViewportEnd = inViewportStart + viewportSize;

    const thisViewportStart = this.viewportStart;
    const thisViewportEnd = thisViewportStart + viewportSize;

    const copyStart = Math.max(thisViewportStart, inViewportStart);
    const copyEnd = Math.min(thisViewportEnd, inViewportEnd);
    const copyLength = copyEnd - copyStart;
    if (copyLength <= 0) {
      return;
    }
    const inLineOffset = copyStart - inViewportStart;
    const thisLineOffset = copyStart - thisViewportStart;

    const inView = new DataView(marshaledBytes);

    for (let i = 0; i < copyLength; ++i) {
      const inOffset = (inLineOffset + i) * 5;
      const inValueLength = inView.getInt32((inOffset + 0) * 4, this.littleEndian);

      const thisOffset = (thisLineOffset + i) * 5;
      const thisValueLength = this.dataView.getFloat32((thisOffset + 0) * 4, this.littleEndian);

      if (inValueLength > thisValueLength) {
        this.dataView.setInt32((thisOffset + 0) * 4, inValueLength, this.littleEndian);
        this.dataView.setFloat32((thisOffset + 1) * 4, inView.getFloat32((inOffset + 1) * 4, this.littleEndian), this.littleEndian);
        this.dataView.setFloat32((thisOffset + 2) * 4, inView.getFloat32((inOffset + 2) * 4, this.littleEndian), this.littleEndian);
        this.dataView.setFloat32((thisOffset + 3) * 4, inView.getFloat32((inOffset + 3) * 4, this.littleEndian), this.littleEndian);
        this.dataView.setFloat32((thisOffset + 4) * 4, inView.getFloat32((inOffset + 4) * 4, this.littleEndian), this.littleEndian);
      }
    }

    for (let i = 0; i < 256; ++i) {
      const line = this.get(i);
      if (!line || line.values.length === 0) {
        continue;
      }
      console.log(`line: ${i + 1}`, line.values);
    }
  }
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
    marshalByteStride: 4,
    marshalBytesInto(value: float, into: BufferFiller, indexOffset: number): void {
      into.write_float(0, value);
    },
  },
  get float4() { return BopFloat4; },
  get Array() { return BopArray; },
  Texture: {
    persistent(width: number, height: number, channels?: number) {
      return SharedMTLInternals().dequeuePersistentTexture(width, height, channels);
    },
    get_size(texture: BopTexture) {
      return new BopFloat4(texture.width, texture.height);
    },
  },

  debugOuts: new BopLibDebugOuts(),

  exportDebugOut(lineNumber: number, length: number, v0: number, v1: number, v2: number, v3: number) {
    this.debugOuts.write(lineNumber, length, v0, v1, v2, v3);
  },

  continueFlag: undefined as (utils.Resolvable<unknown>|undefined),
};

class BopFloat4 {
  static readonly fields = {
    x: BopLib.float,
    y: BopLib.float,
    z: BopLib.float,
    w: BopLib.float,
  };

  static marshalByteStride: number = BopLib.float.marshalByteStride * 4;
  static marshalBytesInto(value: BopFloat4, into: BufferFiller, indexOffset: number): void {
    into.write_float4(0, value as unknown as float4);
  }

  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x?: number, y?: number, z?: number, w?: number) {
    if (x !== undefined && y === undefined && z === undefined && w === undefined) {
      this.x = x;
      this.y = x;
      this.z = x;
      this.w = x;
    } else {
      this.x = x ?? 0.0;
      this.y = y ?? 0.0;
      this.z = z ?? 0.0;
      this.w = w ?? 0.0;
    }
  }
  static ['constructor'](x?: number, y?: number, z?: number, w?: number) {
    return new this(x, y, z, w);
  }
  static get_zero() { return new BopFloat4(0, 0, 0, 0); }
  static get_one() { return new BopFloat4(1, 1, 1, 1); }
  static get_x(self: BopFloat4) { return self.x; }
  static get_y(self: BopFloat4) { return self.y; }
  static get_z(self: BopFloat4) { return self.z; }
  static get_w(self: BopFloat4) { return self.w; }
  static set_x(self: BopFloat4, v: number) { self.x = v; }
  static set_y(self: BopFloat4, v: number) { self.y = v; }
  static set_z(self: BopFloat4, v: number) { self.z = v; }
  static set_w(self: BopFloat4, v: number) { self.w = v; }

  static operatorAdd(lhs: BopFloat4|number, rhs: BopFloat4|number) {
    if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
      if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
        return new this(lhs + rhs.x, lhs + rhs.y, lhs + rhs.z, lhs + rhs.w);
      } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
        return new this(lhs.x + rhs, lhs.y + rhs, lhs.z + rhs, lhs.w + rhs);
      } else {
        throw new Error();
      }
    }
    return new this(lhs.x + rhs.x, lhs.y + rhs.y, lhs.z + rhs.z, lhs.w + rhs.w);
  }
  static operatorSubtract(lhs: BopFloat4|number, rhs: BopFloat4|number) {
    if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
      if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
        return new this(lhs - rhs.x, lhs - rhs.y, lhs - rhs.z, lhs - rhs.w);
      } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
        return new this(lhs.x - rhs, lhs.y - rhs, lhs.z - rhs, lhs.w - rhs);
      } else {
        throw new Error();
      }
    }
    return new this(lhs.x - rhs.x, lhs.y - rhs.y, lhs.z - rhs.z, lhs.w - rhs.w);
  }
  static operatorMultiply(lhs: BopFloat4|number, rhs: BopFloat4|number) {
    if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
      if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
        return new this(lhs * rhs.x, lhs * rhs.y, lhs * rhs.z, lhs * rhs.w);
      } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
        return new this(lhs.x * rhs, lhs.y * rhs, lhs.z * rhs, lhs.w * rhs);
      } else {
        throw new Error();
      }
    }
    return new this(lhs.x * rhs.x, lhs.y * rhs.y, lhs.z * rhs.z, lhs.w * rhs.w);
  }
  static operatorDivide(lhs: BopFloat4|number, rhs: BopFloat4|number) {
    if (typeof(lhs) === 'number' || typeof(rhs) === 'number') {
      if (typeof(lhs) === 'number' && typeof(rhs) !== 'number') {
        return new this(lhs / rhs.x, lhs / rhs.y, lhs / rhs.z, lhs / rhs.w);
      } else if (typeof(lhs) !== 'number' && typeof(rhs) === 'number') {
        return new this(lhs.x / rhs, lhs.y / rhs, lhs.z / rhs, lhs.w / rhs);
      } else {
        throw new Error();
      }
    }
    return new this(lhs.x / rhs.x, lhs.y / rhs.y, lhs.z / rhs.z, lhs.w / rhs.w);
  }
  static operatorNegate(lhs: BopFloat4) {
    return new this(-lhs.x, -lhs.y, -lhs.z, -lhs.w);
  }
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
      // console.log("device.createBuffer");
      this.gpuBuffer?.destroy();
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
      // console.log("ensureGpuBuffer", "device.queue.writeBuffer(this.gpuBuffer, 0, bufferFiller.getBuffer(), 0, byteLength);");
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
      this.gpuVertexBuffer?.destroy();
      this.gpuVertexBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      gpuDirty = true;
    }
    if (gpuDirty) {
      this.gpuVertexDirty = false;
      commandEncoder.copyBufferToBuffer(gpuBuffer, 0, this.gpuVertexBuffer, 0, byteLength);
      // console.log("ensureGpuVertexBuffer", "commandEncoder.copyBufferToBuffer(gpuBuffer, 0, this.gpuVertexBuffer, 0, byteLength);");
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

  static persistent<T>(clsT: BopClass, l: number): BopArray<T> {
    return SharedMTLInternals().dequeuePersistentArray(clsT, l);
  }
  static at<T>(clsT: BopClass, a: BopArray<T>, index: number) { return a.getImpl().at(index); }
  static push<T>(clsT: BopClass, a: BopArray<T>, v: T) { a.getImpl().push(v); }
  static get_length<T>(clsT: BopClass, a: BopArray<T>) { return a.getImpl().length; }
}

class BopTexture {
  private texture?: GPUTexture;
  private textureView?: GPUTextureView;

  constructor(public width: number, public height: number, public channels: number = 4) {
  }

  get requiresGpuUpdate() {
    return !(this.texture && this.texture.width === this.width && this.texture.height === this.height);
  }

  resize(width: number, height: number, channels: number = 4) {
    this.width = width;
    this.height = height;
  }

  getTextureView(): GPUTextureView|undefined {
    return this.textureView;
  }

  ensureGpuBuffer() {
    const device = SharedMTLInternals().device;
    if (!device) {
      return;
    }

    if (!this.requiresGpuUpdate) {
      return;
    }

    this.texture?.destroy();
    this.texture = device.createTexture({
      size: [this.width, this.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.textureView = this.texture.createView()!;
  }
}
class BopTextureSampler {
  private sampler?: GPUSampler;

  get requiresGpuUpdate() {
    return !this.sampler;
  }

  ensureGpu() {
    const device = SharedMTLInternals().device;
    if (!device) {
      return;
    }

    if (!this.requiresGpuUpdate) {
      return;
    }

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });
  }

  getSampler(): GPUSampler|undefined {
    return this.sampler;
  }
}
class BopTextureEntry {
  constructor(readonly texture: BopTexture, readonly sampler: BopTextureSampler) {}
}





export class BufferFiller {
  readonly arrayBuffer;
  readonly dataView;
  private writeOffset = 0;

  constructor(readonly byteLength: number) {
    this.arrayBuffer = new ArrayBuffer(Math.max(48, byteLength));
    this.dataView = new DataView(this.arrayBuffer);
  }

  // TODO: Remove offset param.
  write_float(offset: number, value: float) {
    this.dataView.setFloat32(this.writeOffset, value as unknown as number, true);
    this.writeOffset += 4;
  }
  write_float2(offset: number, value: float2) {
    this.write_float(0, value.x);
    this.write_float(0, value.y);
  }
  write_float3(offset: number, value: float3) {
    this.write_float(0, value.x);
    this.write_float(0, value.y);
    this.write_float(0, value.z);
  }
  write_float4(offset: number, value: float4) {
    this.write_float(0, value.x);
    this.write_float(0, value.y);
    this.write_float(0, value.z);
    this.write_float(0, value.w);
  }
  write_int(offset: number, value: int) {
    this.dataView.setInt32(this.writeOffset, value as unknown as number, true);
    this.writeOffset += 4;
  }
  write_int2(offset: number, value: int2) {
    this.write_int(0, value.x);
    this.write_int(0, value.y);
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

  readonly debugOutsViewportSize = 128;

  get device() { return this._device; }
  private _device?: GPUDevice;

  private readonly shaderCodeProvider = new utils.Resolvable<string>();
  private readonly targetCanvasContextProvider = new utils.Resolvable<GPUCanvasContext>();

  private debugInOuts?: {
    prepare(): void;
    readback(): Promise<void>;
    createDebugInOutsBindGroup(layout: GPUBindGroupLayout): GPUBindGroup;
  };

  markFrameStart() {
    this.prepareDebugInOuts();
    this.resetPersistentArrays();
  }
  markFrameEnd() {
    this.readbackDebugOuts();
  }

  private readonly persisentArrays = new Map<BopClass, { all: Array<BopArray<any>>; queue: Array<BopArray<any>>; }>();
  private readonly persisentTextures: { all: Array<BopTexture>; queue: Array<BopTexture>; } = { all: [], queue: [] };

  private resetPersistentArrays() {
    for (const entries of this.persisentArrays.values()) {
      entries.queue.splice(0);
      entries.queue.push(...entries.all);
    }
  }

  dequeuePersistentArray(elementType: BopClass, l: number): BopArray<any> {
    let entries = this.persisentArrays.get(elementType);
    if (entries === undefined) {
      entries = { all: [], queue: [] };
      this.persisentArrays.set(elementType, entries);
    }
    if (entries.queue.length > 0) {
      return entries.queue.pop()!;
    }
    const newArray = new BopArray<any>(elementType, l);
    entries.all.push(newArray);
    return newArray;
  }

  dequeuePersistentTexture(width: number, height: number, channels?: number): BopTexture {
    const entries = this.persisentTextures;
    if (entries.queue.length > 0) {
      const oldEntry = entries.queue.pop()!;
      oldEntry.resize(width, height, channels);
      return oldEntry;
    }
    const newEntry = new BopTexture(width, height, channels);
    entries.all.push(newEntry);
    return newEntry;
  }

  private prepareDebugInOuts() {
    this.globalEncoderQueue.push(async () => {
      this.debugInOuts?.prepare();
    });
  }

  // GRR WebGPU bind group layouts must be exactly the same instance.
  createDebugInOutsBindGroup(layout: GPUBindGroupLayout): GPUBindGroup {
    return this.debugInOuts!.createDebugInOutsBindGroup(layout);
  }

  private readbackDebugOuts() {
    this.debugInOuts?.readback();
  }

  constructor() {
    const ready = this.ready = (async () => {
      const adapter = await navigator.gpu.requestAdapter() ?? undefined;
      const device = await adapter?.requestDevice();
      this._device = device;
      if (!adapter || !device) {
        console.error('WebGPU initialization failed.');
      }
      if (device) {
        const insValuesProxy = new BopArray(BopFloat4, 100);

        const outsMetadataByteLength = 2 * 4;
        const outsMetadataCpuBuffer = new ArrayBuffer(outsMetadataByteLength);
        const outsMetadataCpuView = new DataView(outsMetadataCpuBuffer);
        const outsMetadataGpuBuffer = device.createBuffer({
          size: outsMetadataByteLength,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM
        });

        const outsValuesArrayByteLength = this.debugOutsViewportSize * 5 * 4;
        const outsValuesArrayCpuBuffer = new ArrayBuffer(outsValuesArrayByteLength);
        const outsValuesArrayCpuBufferUint8 = new Uint8Array(outsValuesArrayCpuBuffer);
        const outsValuesArrayGpuBufferStorage = device.createBuffer({
          size: outsValuesArrayByteLength,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE
        });
        const outsValuesArrayGpuBufferReadable = device.createBuffer({
          size: outsValuesArrayByteLength,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        let currentInsValuesGpuBuffer: GPUBuffer|undefined;
        let currentBindGroup: GPUBindGroup|undefined;

        let prepareDebugOutsViewportStart = 0;

        let readbackRunning = false;
        let readbackQueued = false;
        const doReadback = async () => {
          readbackQueued = false;
          readbackRunning = true;
          await this.ready;
          await this.globalEncoderQueue.push(async () => {
            try {
              const thisViewportStart = prepareDebugOutsViewportStart;
              const commandEncoder = device.createCommandEncoder();
              commandEncoder.copyBufferToBuffer(outsValuesArrayGpuBufferStorage, 0, outsValuesArrayGpuBufferReadable, 0, outsValuesArrayByteLength);
              device.queue.submit([commandEncoder.finish()]);

              await outsValuesArrayGpuBufferReadable.mapAsync(GPUMapMode.READ, 0, outsValuesArrayByteLength);
              const readValues = outsValuesArrayGpuBufferReadable.getMappedRange();
              outsValuesArrayCpuBufferUint8.set(new Uint8Array(readValues));
              outsValuesArrayGpuBufferReadable.unmap();

              // Merge into CPU view.
              BopLib.debugOuts.merge(thisViewportStart, outsValuesArrayCpuBuffer);
            } finally {
              readbackRunning = false;
            }
          });
          if (readbackQueued) {
            doReadback();
          }
        };

        const createDebugInOutsBindGroup = (insValuesGpuBuffer: GPUBuffer, layout: GPUBindGroupLayout) => {
          const bindGroupEntries: GPUBindGroupEntry[] = [
            {
              binding: 0,
              resource: {
                buffer: insValuesGpuBuffer,
              },
            },
            {
              binding: 1,
              resource: {
                buffer: outsMetadataGpuBuffer,
              }
            },
            {
              binding: 2,
              resource: {
                buffer: outsValuesArrayGpuBufferStorage,
              }
            },
          ];
          return device.createBindGroup({
            layout: layout,
            entries: bindGroupEntries,
          });
        };

        this.debugInOuts = {
          prepare: () => {
            // Upload new ins.
            insValuesProxy.getImpl().ensureGpuBuffer();
            const insValuesGpuBuffer = insValuesProxy.getImpl().getGpuBuffer();
            if (!insValuesGpuBuffer) {
              return;
            }

            if (!currentBindGroup || currentInsValuesGpuBuffer !== insValuesGpuBuffer) {
              currentInsValuesGpuBuffer = insValuesGpuBuffer;
              const layout = device.createBindGroupLayout({
                entries: [
                  {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                      type: 'uniform',
                    },
                  },
                  {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                      type: 'uniform',
                    },
                  },
                  {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: {
                      type: 'storage',
                    },
                  },
                ],
              });
              currentBindGroup = createDebugInOutsBindGroup(insValuesGpuBuffer, layout);
            }

            // Prepare outs viewport, and clear out flags.
            outsMetadataCpuView.setInt32(0 * 4, BopLib.debugOuts.viewportStart);
            outsMetadataCpuView.setInt32(1 * 4, BopLib.debugOuts.viewportEnd);
            device.queue.writeBuffer(outsMetadataGpuBuffer, 0, outsMetadataCpuBuffer, 0, outsMetadataCpuBuffer.byteLength);
            const commandEncoder = device.createCommandEncoder();
            commandEncoder.clearBuffer(outsValuesArrayGpuBufferStorage);
            device.queue.submit([commandEncoder.finish()]);
          },
          readback: async () => {
            if (!readbackRunning) {
              await doReadback();
            } else {
              readbackQueued = true;
            }
          },
          createDebugInOutsBindGroup(layout) {
            const insValuesGpuBuffer = insValuesProxy.getImpl().getGpuBuffer();
            return createDebugInOutsBindGroup(insValuesGpuBuffer!, layout);
          },
        };
      }
      return { adapter, device };
    })();
    const shadersReady = this.shadersReady = (async () => {
      const { device } = await ready;
      const code = await this.shaderCodeProvider.promise;

      const shaderModule = device?.createShaderModule({
        code: WGSL_LIB_PREAMBLE_CODE + code + WGSL_LIB_CODE,
      });
      const compilationInfo = await shaderModule?.getCompilationInfo();
      if ((compilationInfo?.messages.length ?? 0) > 0) {
        console.warn(compilationInfo?.messages.map(m => `${m.lineNum}:${m.linePos} ${m.type}: ${m.message}`).join('\n'));
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

function MTLCreateSampler() {
  return new BopTextureSampler();
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
  return new BopLib.float4(r, g, b, a);
}

function MTLToGpuColor(c: BopFloat4): GPUColor {
  return { r: c.x, g: c.y, b: c.z, a: c.w };
}





class MTLRenderCommandEncoder {
  label = 'Unknown Encoder';
  cullMode = MTLCullMode.MTLCullModeNone;
  renderPipelineState = InvalidMTLRenderPipelineState();

  readonly vertexAttributeBytes: Array<BopArray<unknown>|undefined> = [];
  readonly vertexBytes: Array<ArrayBuffer|BopArray<unknown>|BopTextureEntry|undefined> = [];
  readonly fragmentBytes: Array<ArrayBuffer|BopArray<unknown>|BopTextureEntry|undefined> = [];

  private readonly preready;
  private readonly ready;
  private readonly prequeue = new utils.OperationQueue();
  private readonly queue = new utils.OperationQueue();
  private readonly compileFlag = new utils.Resolvable();
  private readonly finishedEncodingFlag = new utils.WaitableFlag();

  constructor(readonly renderPassDescriptor: MTLRenderPassDescriptor) {
    this.preready = (async () => {
      const internals = SharedMTLInternals();

      const acquiredGlobalLock = new utils.Resolvable();
      internals.globalEncoderQueue.push(async () => {
        acquiredGlobalLock.resolve(undefined);
        await this.finishedEncodingFlag.wait();
      });
      await acquiredGlobalLock.promise;
      // console.log("MTLRenderCommandEncoder", "acquiredGlobalLock");

      await this.compileFlag.promise;
      const { device } = await internals.ready;
      const { targetTextureViewFunc } = await internals.targetReady;
      this.renderPipelineState.descriptor.compile();
      const { renderPipeline } = await this.renderPipelineState.descriptor.ready;

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

  setVertexBytes(buffer: ArrayBuffer|BopArray<unknown>|BopTextureEntry, index: number) {
    this.vertexBytes[index] = buffer;
  }

  setFragmentBytes(buffer: ArrayBuffer|BopArray<unknown>|BopTextureEntry, index: number) {
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

  dataBytes: Array<ArrayBuffer|BopArray<unknown>|BopTextureEntry|undefined> = [];

  readonly ready;
  private readonly queue = new utils.OperationQueue();
  private readonly compileFlag = new utils.Resolvable();
  private readonly finishedEncodingFlag = new utils.WaitableFlag();

  constructor() {
    this.ready = (async () => {
      const internals = SharedMTLInternals();
      const acquiredGlobalLock = new utils.Resolvable();
      internals.globalEncoderQueue.push(async () => {
        acquiredGlobalLock.resolve(undefined);
        await this.finishedEncodingFlag.wait();
      });
      await acquiredGlobalLock.promise;
      // console.log("MTLComputeCommandEncoder", "acquiredGlobalLock");

      await this.compileFlag.promise;
      const { device } = await internals.ready;
      this.pipelineState.descriptor.compile();
      const { pipeline } = await this.pipelineState.descriptor.ready;

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

  setBytes(buffer: ArrayBuffer|BopArray<unknown>|BopTextureEntry, index: number) {
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
  // console.log('EncoderSetVertexAttributeBuffer', encoder, buffer, offset, index);
  const bufferImpl = buffer.getImpl();
  bufferImpl.ensureGpuBuffer();
  encoder.queuePretask(async (commandEncoder) => {
    bufferImpl.ensureGpuVertexBuffer(commandEncoder);
  });
  encoder.setVertexAttributeBytes(buffer, index);
}

function EncoderSetVertexBytes(encoder: MTLRenderCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  // console.log('EncoderSetVertexBytes', encoder, buffer, offset, index);
  encoder.setVertexBytes(buffer, index);
}
function EncoderSetVertexBuffer(encoder: MTLRenderCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  // console.log('EncoderSetVertexBuffer', encoder, buffer, offset, index);
  buffer.getImpl().ensureGpuBuffer();
  encoder.setVertexBytes(buffer, index);
}
function EncoderSetVertexTexture(encoder: MTLRenderCommandEncoder, texture: BopTexture, sampler: BopTextureSampler, index: number) {
  // console.log('EncoderSetVertexBuffer', encoder, buffer, offset, index);
  texture.ensureGpuBuffer();
  sampler.ensureGpu();
  encoder.setVertexBytes(new BopTextureEntry(texture, sampler), index);
}
function EncoderSetFragmentBytes(encoder: MTLRenderCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  // console.log('EncoderSetFragmentBytes', encoder, buffer, offset, index);
  encoder.setFragmentBytes(buffer, index);
}
function EncoderSetFragmentBuffer(encoder: MTLRenderCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  // console.log('EncoderSetFragmentBuffer', encoder, buffer, offset, index);
  buffer.getImpl().ensureGpuBuffer();
  encoder.setFragmentBytes(buffer, index);
}
function EncoderSetFragmentTexture(encoder: MTLRenderCommandEncoder, texture: BopTexture, sampler: BopTextureSampler, index: number) {
  // console.log('EncoderSetFragmentTexture', encoder, buffer, offset, index);
  texture.ensureGpuBuffer();
  sampler.ensureGpu();
  encoder.setFragmentBytes(new BopTextureEntry(texture, sampler), index);
}
function EncoderDrawPrimitives(encoder: MTLRenderCommandEncoder, type: MTLPrimitiveType, offset: number, count: number) {
  // console.log('EncodeDrawPrimitives', encoder, type, offset, count);
  const proxyEncoder = encoder;
  encoder.queueTask(async (encoder, commandEncoder, device, renderPipeline) => {
    const internals = SharedMTLInternals();
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
    const vertexBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: EncoderMarshalBindGroupEntries(device, proxyEncoder.vertexBytes),
    });
    const fragmentBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(1),
      entries: EncoderMarshalBindGroupEntries(device, proxyEncoder.fragmentBytes),
    });
    encoder.setBindGroup(0, vertexBindGroup);
    encoder.setBindGroup(1, fragmentBindGroup);
    // encoder.setBindGroup(2, internals.createDebugInOutsBindGroup(renderPipeline.getBindGroupLayout(2)));
    encoder.draw(count);
  });
}



function MakeMTLComputeCommandEncoder(): MTLComputeCommandEncoder {
  return new MTLComputeCommandEncoder();
}
function EncoderSetComputeBytes(encoder: MTLComputeCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  // console.log('EncoderSetComputeBytes', encoder, buffer, offset, index);
  encoder.setBytes(buffer, index);
}
function EncoderSetComputeBuffer(encoder: MTLComputeCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  // console.log('EncoderSetComputeBuffer', encoder, buffer, offset, index);
  buffer.getImpl().ensureGpuBuffer();
  encoder.setBytes(buffer, index);
}
function EncoderSetComputeTexture(encoder: MTLComputeCommandEncoder, texture: BopTexture, sampler: BopTextureSampler, index: number) {
  // console.log('EncoderSetComputeBuffer', encoder, buffer, offset, index);
  texture.ensureGpuBuffer();
  sampler.ensureGpu();
  encoder.setBytes(new BopTextureEntry(texture, sampler), index);
}
function EncoderDispatchWorkgroups(encoder: MTLComputeCommandEncoder, count: number) {
  // console.log('EncoderDispatchWorkgroups', encoder, count);
  const proxyEncoder = encoder;
  encoder.queueTask(async (encoder, commandEncoder, device, renderPipeline) => {
    const internals = SharedMTLInternals();
    const dataBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: EncoderMarshalBindGroupEntries(device, proxyEncoder.dataBytes),
    });
    encoder.setBindGroup(0, dataBindGroup);
    encoder.setBindGroup(1, device.createBindGroup({ layout: renderPipeline.getBindGroupLayout(1), entries: [] }));
    encoder.setBindGroup(2, internals.createDebugInOutsBindGroup(renderPipeline.getBindGroupLayout(2)));
    encoder.dispatchWorkgroups(count);
  });
}

function EncoderMarshalBindGroupEntries(device: GPUDevice, buffers: Array<ArrayBuffer|BopArray<unknown>|BopTextureEntry|undefined>) {
  const bindGroupEntries: GPUBindGroupEntry[] = [];
  let nextBindingIndex = 0;
  for (let index = 0; index < buffers.length; ++index) {
    const byteArray = buffers[index];
    let resource: GPUBindingResource|undefined;
    let auxResource: GPUBindingResource|undefined;
    if (byteArray instanceof BopArray) {
      const bufferBuffer = byteArray.getImpl().getGpuBuffer();
      if (!bufferBuffer) {
        console.log("missing!!!", "byteArray.getImpl().getGpuBuffer();");
        continue;
      }
      resource = { buffer: bufferBuffer };
    } else if (byteArray instanceof BopTextureEntry) {
      const bufferBuffer = byteArray.texture.getTextureView();
      const sampler = byteArray.sampler.getSampler();
      if (!bufferBuffer) {
        console.log("missing!!!", "byteArray.texture.getTextureView();");
        continue;
      }
      if (!sampler) {
        console.log("missing!!!", "byteArray.sampler.getSampler();");
        continue;
      }
      resource = bufferBuffer;
      auxResource = sampler;
    } else {
      if (!byteArray) {
        continue;
      }
      // TODO: Pool allocate TMP buffer.
      const bufferBuffer = device.createBuffer({
        size: byteArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM
      });
      device.queue.writeBuffer(bufferBuffer, 0, byteArray, 0, byteArray.byteLength);
      resource = { buffer: bufferBuffer };
    }

    const bindGroupEntry: GPUBindGroupEntry = {
      binding: nextBindingIndex++,
      resource: resource
    };
    bindGroupEntries.push(bindGroupEntry);
    if (auxResource) {
      const auxBindGroupEntry: GPUBindGroupEntry = {
        binding: nextBindingIndex++,
        resource: auxResource
      };
      bindGroupEntries.push(auxBindGroupEntry);
    }
  }
  return bindGroupEntries;
}


function EncoderEndEncoding(encoder: MTLRenderCommandEncoder|MTLComputeCommandEncoder) {
  encoder.queueTask(async (encoder, commandEncoder, device) => {
    encoder.end();
    device.queue.submit([commandEncoder.finish()]);
    return { finishedEncoding: true };
  });
}

export function PopInternalContinueFlag(): utils.Resolvable<unknown>|undefined {
  const continueFlag = BopLib.continueFlag;
  BopLib.continueFlag = undefined;
  return continueFlag;
}

export function PushInternalContinueFlag(flag: utils.Resolvable<unknown>) {
  BopLib.continueFlag = flag;
}

async function WaitForInternalsReady() {
  await SharedMTLInternals().ready;
}

function InternalMarkFrameStart() {
  SharedMTLInternals().markFrameStart();
}

function InternalMarkFrameEnd() {
  SharedMTLInternals().markFrameEnd();
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
