import * as utils from '../utils';
import { WGSL_LIB_CODE } from './bop-wgsl-lib';




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
    constructor(x: number, y: number, z: number, w: number): BopFloat4 {
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

class BopArray<T> {
  readonly buffer: T[];
  length: number = 0;

  constructor(readonly elementType: BopClass|undefined, readonly capacity: number) {
    const value: T = new (elementType as any)();
    this.buffer = new Array<T>(capacity);

    return new Proxy(this, {
      set(target, p, newValue, receiver) {
        const rawValue = Reflect.get(target, p, receiver);
        if (typeof(p) !== 'string' || rawValue !== undefined) {
          return Reflect.set(target, p, newValue, receiver);
        }
        target.buffer[parseInt(p)] = newValue;
        return true;
      },
      get(target, p, receiver) {
        const rawValue = Reflect.get(target, p, receiver);
        if (typeof(p) !== 'string' || rawValue !== undefined) {
          return rawValue;
        }
        return target.buffer[parseInt(p)];
      },
    });
  }

  at(i: number) {
    return this.buffer[i];
  }
  push(v: T) {
    this.buffer[this.length++] = v;
  }

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

  private readonly shaderCodeProvider = new utils.Resolvable<string>();
  private readonly targetCanvasContextProvider = new utils.Resolvable<GPUCanvasContext>();

  constructor() {
    const ready = this.ready = (async () => {
      const adapter = await navigator.gpu.requestAdapter() ?? undefined;
      const device = await adapter?.requestDevice();
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

  vertexBytes: Array<ArrayBuffer|undefined> = [];
  fragmentBytes: Array<ArrayBuffer|undefined> = [];

  readonly ready;
  private readonly queue = new utils.OperationQueue();
  private readonly compileFlag = new utils.Resolvable();

  constructor(readonly renderPassDescriptor: MTLRenderPassDescriptor) {
    this.ready = (async () => {
      const internals = SharedMTLInternals();
      await this.compileFlag.promise;
      const { device } = await internals.ready;
      const { targetTextureViewFunc } = await internals.targetReady;
      this.renderPipelineState.descriptor.compile();
      const { renderPipeline } = await this.renderPipelineState.descriptor.ready;
      const commandEncoder = device?.createCommandEncoder();

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
      if (renderPipeline) {
        encoder?.setPipeline(renderPipeline);
      }
      return { device, commandEncoder, encoder, renderPipeline };
    })();
    this.queue.push(() => this.ready);
  }

  setVertexBytes(buffer: ArrayBuffer, index: number) {
    this.vertexBytes[index] = buffer;
  }

  setFragmentBytes(buffer: ArrayBuffer, index: number) {
    this.fragmentBytes[index] = buffer;
  }

  queueTask(runner: (encoder: GPURenderPassEncoder, commandEncoder: GPUCommandEncoder, device: GPUDevice, renderPipeline: GPURenderPipeline) => Promise<unknown>) {
    this.compileFlag.resolve(undefined);
    this.queue.push(async () => {
      const { device, commandEncoder, encoder, renderPipeline } = await this.ready;
      if (!device || !encoder || !commandEncoder || !renderPipeline) {
        return;
      }
      await runner(encoder, commandEncoder, device, renderPipeline);
    });
  }
}

export enum MTLCullMode {
  MTLCullModeNone = 'MTLCullModeNone',
}

export enum MTLPrimitiveType {
  MTLPrimitiveTypeTriangle = 'MTLPrimitiveTypeTriangle',
}

class BopClass {
  readonly fields?: Record<string, BopClass>;
  stride?: number;
  marshalBytesIntoArrayBuffer?(value: any, index: number, into: Float32Array): void;
}

function getBopClassLayout(bopClass: BopClass|undefined) {
  let marshalBytesIntoArrayBuffer = bopClass?.marshalBytesIntoArrayBuffer;
  let stride = bopClass?.stride ?? 0;
  if (!marshalBytesIntoArrayBuffer) {
    interface Accessor {
      getter?: (value: any, buffer: Float32Array, offset: number) => any;
      children?: Accessor[];
    }

    let writeLength = 0;
    const enumerateFieldsRec = (fields: Record<string, BopClass>): Accessor[] => {
      const children = [];
      for (const [ fieldName, fieldType ] of Object.entries(fields)) {
        if (fieldType.fields) {
          children.push({
            getter: (parent: any) => parent[fieldName],
            children: enumerateFieldsRec(fieldType.fields),
          });
        } else if (fieldType === BopLib.float) {
          const fieldLength = 4;
          const thisFieldOffset = writeLength;
          children.push({
            getter: (parent: any, buffer: Float32Array, offset: number) => {
              const floatValue = parent[fieldName] as number;
              buffer[(offset + thisFieldOffset) >> 2] = floatValue;
            },
          });
          writeLength += fieldLength;
        }
      }
      return children;
    };

    let fieldCopyAccessors: Accessor[];
    if (bopClass?.fields) {
      fieldCopyAccessors = enumerateFieldsRec(bopClass.fields);
      stride = writeLength;
    } else if (bopClass === BopLib.float) {
      stride = 4;
      fieldCopyAccessors = [{
        getter: (parent: any, buffer: Float32Array, offset: number) => {
          const floatValue = parent as number;
          buffer[(offset + writeLength) >> 2] = floatValue;
        },
      }];
    } else {
      stride = 0;
      fieldCopyAccessors = [];
    }

    const copyRec = (parent: any, offset: number, accessors: Accessor[], into: Float32Array) => {
      for (const accessor of accessors) {
        const fieldValue = accessor.getter?.(parent, into, offset);
        if (accessor.children) {
          copyRec(fieldValue, offset, accessor.children, into);
        }
      }
    };

    marshalBytesIntoArrayBuffer = (value: any, index: number, into: Float32Array) => {
      const offset = index * stride;
      copyRec(value, offset, fieldCopyAccessors, into);
    };

    if (bopClass) {
      bopClass.stride = stride;
      bopClass.marshalBytesIntoArrayBuffer = marshalBytesIntoArrayBuffer;
    }
  }
  return {
    stride,
    marshalBytesIntoArrayBuffer,
  };
}

function MakeMTLRenderCommandEncoder(renderPassDescriptor: MTLRenderPassDescriptor): MTLRenderCommandEncoder {
  return new MTLRenderCommandEncoder(renderPassDescriptor);
}
function EncoderSetVertexBuffer(encoder: MTLRenderCommandEncoder, buffer: BopArray<unknown>, offset: number, index: number) {
  console.log('EncoderSetVertexBuffer', encoder, buffer, offset, index);
  encoder.queueTask(async (encoder, commandEncoder, device) => {
    // TODO: Shadow copy buffer!!!
    const elementZero = buffer.buffer[0];
    const elementClass = elementZero?.constructor as BopClass|undefined;
    const { stride, marshalBytesIntoArrayBuffer } = getBopClassLayout(elementClass);

    const byteLength = stride * buffer.length;
    const vertices = new Float32Array(byteLength >> 2);
    for (let i = 0; i < buffer.length; ++i) {
      marshalBytesIntoArrayBuffer(buffer.buffer[i], i, vertices);
    }
    const vertexBuffer = device.createBuffer({
      size: vertices.byteLength, // make it big enough to store vertices in
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertices, 0, vertices.length);
    encoder.setVertexBuffer(index, vertexBuffer);
  });
}

function EncoderSetVertexBytes(encoder: MTLRenderCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  console.log('EncoderSetVertexBytes', encoder, buffer, offset, index);
  encoder.setVertexBytes(buffer, index);
}
function EncoderSetFragmentBytes(encoder: MTLRenderCommandEncoder, buffer: ArrayBuffer, offset: number, index: number) {
  console.log('EncoderSetFragmentBytes', encoder, buffer, offset, index);
  encoder.setFragmentBytes(buffer, index);
}
function EncoderDrawPrimitives(encoder: MTLRenderCommandEncoder, type: MTLPrimitiveType, offset: number, count: number) {
  console.log('EncodeDrawPrimitives', encoder, type, offset, count);
  const proxyEncoder = encoder;
  encoder.queueTask(async (encoder, commandEncoder, device, renderPipeline) => {
    const vertexBindGroupEntries: GPUBindGroupEntry[] = [];
    const fragmentBindGroupEntries: GPUBindGroupEntry[] = [];

    const marshalBindGroupEntries = (buffers: Array<ArrayBuffer|undefined>) => {
      const bindGroupEntries: GPUBindGroupEntry[] = [];
      for (let index = 0; index < buffers.length; ++index) {
        const byteArray = buffers[index];
        if (!byteArray) {
          continue;
        }
        const bufferBuffer = device.createBuffer({
          size: byteArray.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM
        });
        device.queue.writeBuffer(bufferBuffer, 0, byteArray, 0, byteArray.byteLength);

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
function EncoderEndEncoding(encoder: MTLRenderCommandEncoder) {
  encoder.queueTask(async (encoder, commandEncoder, device) => {
    encoder.end();
    device.queue.submit([commandEncoder.finish()]);
  });
}









// let v_3_DrawTriangle = MakeMTLRenderPassDescriptor();
// v_3_DrawTriangle.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
// v_3_DrawTriangle.colorAttachments[0].loadAction = MTLLoadActionClear;
// v_3_DrawTriangle.colorAttachments[0].storeAction = MTLStoreActionStore;


// let v_0_DrawTriangle = MTLLibraryNewFunctionWithName("F2_vertexShader");
// let v_1_DrawTriangle = MTLLibraryNewFunctionWithName("F3_fragmentShader");
// let v_2_DrawTriangle = MakeMTLRenderPipelineDescriptor();
// v_2_DrawTriangle.label = "RenderPrimitives";
// v_2_DrawTriangle.vertexFunction = v_0_DrawTriangle;
// v_2_DrawTriangle.fragmentFunction = v_1_DrawTriangle;
// v_2_DrawTriangle.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm_sRGB;
// v_2_DrawTriangle.colorAttachments[0].blendingEnabled = true;
// v_2_DrawTriangle.colorAttachments[0].alphaBlendOperation = MTLBlendOperationAdd;
// v_2_DrawTriangle.colorAttachments[0].rgbBlendOperation = MTLBlendOperationAdd;
// v_2_DrawTriangle.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOne;
// v_2_DrawTriangle.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOne;
// v_2_DrawTriangle.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
// v_2_DrawTriangle.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
// f_0_DrawTriangle_pipeline = MTLNewRenderPipelineStateWithDescriptor(v_2_DrawTriangle);
// let v_3_DrawTriangle = MakeMTLRenderPassDescriptor();
// v_3_DrawTriangle.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
// v_3_DrawTriangle.colorAttachments[0].loadAction = MTLLoadActionClear;
// v_3_DrawTriangle.colorAttachments[0].storeAction = MTLStoreActionStore;
// f_1_DrawTriangle_renderPassDescriptor = v_3_DrawTriangle;



// const BopLib = {
//   float4: {
//     constructor(x: number, y: number, z: number, w: number) {
//       return [x, y, z, w];
//     },
//   },
//   Array: {
//   },
// };

// function MTLLibraryNewFunctionWithName(shaderName):  {
//   return {};
// }

// function MakeMTLRenderPipelineDescriptor() {
//   return {
//     label: 'Unnamed Pipeline',
//     vertexFunction: undefined,
//     fragmentFunction: undefined,
//     colorAttachments: [
//       {
//         pixelFormat: undefined,
//         blendingEndabled: undefined,
//         alphaBlendOperation: undefined,
//         rgbBlendOperation: undefined,
//         destinationAlphaBlendFactor: undefined,
//         sourceAlphaBlendFactor: undefined,
//       },
//     ],
//   };
// }

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
