import { html, LitElement, PropertyValueMap } from 'lit';
import {} from 'lit/html';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { action, autorun, observable, makeObservable } from 'mobx';
import { RecyclerView } from './recycler-view';
import { CandidateCompletion, CommandParser, CommandResolvedArg, CommandSpec } from './command-parser';
import * as utils from '../utils';
import * as environment from './environment';
import './simple-icon-element';
import { getCommands } from './app-commands';
import { getBrowserWindow } from './renderer-ipc';
import { handlesFromDataTransfer } from './paths';
import { adoptCommonStyleSheets } from './stylesheets';
import * as bop from './bop';
import { SharedMTLInternals } from './bop-javascript-lib';

RecyclerView; // Necessary, possibly beacuse RecyclerView is templated?

enum Overlay {
  DragDropAccept = 'drag-drop-accept',
}

enum DragDropState {
  NotStarted,
  Success,
  Failure,
}

export enum QueryTokenAtom {
  Title = 'title',
  Artist = 'artist',
  Album = 'album',
  Genre = 'genre',
  Path = 'path',
}

export interface QueryToken {
  text: string;
  atom?: QueryTokenAtom;
}

















const shaders = `
alias BopLib_Array_0 = array<s57_TriangleVertex>;
struct s57_TriangleVertex {
  @builtin(position) f_0_position: vec4f,
  f_1_color: vec4f,
};
struct s58__placeholder_float_ {
  f_0_placeholder: f32,
};
struct s59__alpha_float_ {
  f_0_alpha: f32,
};
struct s62__alpha_number_ {
  f_0_alpha: i32,
};
struct s63__placeholder_number_ {
  f_0_placeholder: i32,
};
fn F1_gpuTest(v_0_value: f32) -> f32 {
  var v_1_Identifier: f32 = v_0_value;
  var v_2_NumericLiteral: i32 = 1;
  var v_3_coersion: f32 = f32(v_2_NumericLiteral);
  var v_4_BinaryExpression: f32 = (v_1_Identifier + v_3_coersion);
  return v_4_BinaryExpression;
}


struct F2_TRAMPOLINE_vertexShader_out {
  @builtin(position) f_0_position: vec4f,
  @location(0) f_1_color: vec4f,
};

@vertex
fn F2_TRAMPOLINE_vertexShader(
    @location(0) v1: vec4f,
    @location(1) v2: vec4f,
    @location(2) v3: f32,
    @builtin(instance_index) v_1_threadId: u32,
) -> F2_TRAMPOLINE_vertexShader_out {
  var v_3_Identifier: s57_TriangleVertex = s57_TriangleVertex(v1, v2);
  var v_2_options: s58__placeholder_float_ = s58__placeholder_float_(v3);
  var tmpOut = F2_vertexShader(v_3_Identifier, v_1_threadId, v_2_options);
  return F2_TRAMPOLINE_vertexShader_out(tmpOut.f_0_position, tmpOut.f_1_color);
}

fn F2_vertexShader(v_0_position: s57_TriangleVertex, v_1_threadId: u32, v_2_options: s58__placeholder_float_) -> s57_TriangleVertex {
  var v_3_Identifier: s57_TriangleVertex = v_0_position;
  return v_3_Identifier;
}

struct F3_TRAMPOLINE_fragmentShader_out {
  @location(0) color: vec4f,
}

@group(0) @binding(0) var<storage, read_write> b2: array<f32>;
@group(0) @binding(1) var<storage, read_write> b3: array<f32>;
@group(0) @binding(2) var<storage, read_write> b4: array<f32>;
@group(0) @binding(3) var<storage, read_write> b5: array<f32>;
@group(0) @binding(4) var<uniform> b6: s63__placeholder_number_;

@fragment
fn F3_TRAMPOLINE_fragmentShader(
    vin: F2_TRAMPOLINE_vertexShader_out,
    @location(1) v1: f32,
) -> F3_TRAMPOLINE_fragmentShader_out {
  // _ = &b2;
  // _ = &b3;
  // _ = &b4;
  // _ = &b5;
  // var value: ptr<function, s63__placeholder_number_> = &b6;
  // _ = t;
  // _ = s;

  var t_0_position: s57_TriangleVertex = s57_TriangleVertex(vin.f_0_position, vin.f_1_color);
  var t_1_threadId: i32 = i32(0);
  var t_2_options: s59__alpha_float_ = s59__alpha_float_(v1);
  var fout = F3_fragmentShader(t_0_position, t_1_threadId, t_2_options);
  return F3_TRAMPOLINE_fragmentShader_out(fout);
}

fn F3_fragmentShader(v_0_position: s57_TriangleVertex, v_1_threadId: i32, v_2_options: s59__alpha_float_) -> vec4f {
  var v_3_Identifier: s57_TriangleVertex = v_0_position;
  var v_4_PropertyAccessExpression: vec4f = v_3_Identifier.f_1_color;
  var v_5_color: vec4f = v_4_PropertyAccessExpression;
  var v_7_Identifier: s59__alpha_float_ = v_2_options;
  var v_8_PropertyAccessExpression: f32 = v_7_Identifier.f_0_alpha;
  var v_9_CallExpression: f32 = F1_gpuTest(v_8_PropertyAccessExpression);
  BopLib_float4_set_w(&v_5_color, v_9_CallExpression);
  var v_11_Identifier: vec4f = v_5_color;
  return v_11_Identifier;
}

fn BopLib_float4_set_x(t: ptr<function, vec4f>, v: f32) { t.x = v; }
fn BopLib_float4_set_y(t: ptr<function, vec4f>, v: f32) { t.y = v; }
fn BopLib_float4_set_z(t: ptr<function, vec4f>, v: f32) { t.z = v; }
fn BopLib_float4_set_w(t: ptr<function, vec4f>, v: f32) { t.w = v; }




struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f
}

@vertex
fn vertex_main(@location(0) position: vec4f,
               @location(1) color: vec4f) -> VertexOut {
  var output : VertexOut;
  output.position = position;
  output.color = color;
  var a = 1.0;
  var b = 1f;
  var c = a + b;
  return output;
}

@fragment
fn fragment_main(fragData: VertexOut) -> @location(0) vec4f {
  return fragData.color;
}




@group(0) @binding(0) var<storage, read_write> computeShader_positions: array<VertexOut>;

@compute @workgroup_size(64)
fn computeShader(@builtin(global_invocation_id) global_id: vec3u) {
  _ = &computeShader_positions;
  var thread_id: i32 = i32(global_id.x);
  var thread_count = 1;
  if (thread_id >= thread_count) {
    return;
  }
  // computeShader_positions[global_id.x].position.x = f32(global_id.x) * 1000. + f32(local_id.x);
  var tmp = computeShader_positions[thread_id];
  tmp.position.x += 0.3;
  *(&computeShader_positions[thread_id]) = tmp;
}


`;

async function doTest(canvas: HTMLCanvasElement) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!adapter || !device) {
    return;
  }
  const shaderModule = device.createShaderModule({
    code: shaders,
  });
  const compilationInfo = await shaderModule.getCompilationInfo();
  if (compilationInfo.messages.length > 0) {
    console.log(compilationInfo.messages.map(m => `${m.lineNum}:${m.linePos} ${m.type}: ${m.message}`).join('\n'));
  }

  const context = canvas.getContext("webgpu");
  if (!context) {
    return;
  }

  if (true as any) {
    SharedMTLInternals().setTargetCanvasContext(context);
    doTest2();
  } else {
    context.configure({
      device: device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });

    const vertices = new Float32Array([
      0.0, 0.6, 0, 1,
      1, 0, 0, 1,

      -0.5, -0.6, 0, 1,
      0, 1, 0, 1,

      0.5, -0.6, 0, 1,
      0, 0, 1, 1,
    ]);
    const vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertices, 0, vertices.length);



    const commandEncoder = device.createCommandEncoder();

    {
      const computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: shaderModule,
          entryPoint: 'computeShader'
        }
      });

      const bindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: vertexBuffer,
          }
        }]
      });

      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(computePipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.dispatchWorkgroups(Math.ceil(3 / 64));
      passEncoder.end();
    }





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
        entryPoint: 'vertex_main',
        buffers: vertexBuffers,
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragment_main',
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
    const renderPipeline = device.createRenderPipeline(pipelineDescriptor);

    const clearColor: GPUColor = { r: 0.0, g: 0.5, b: 1.0, a: 1.0 };
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          clearValue: clearColor,
          loadOp: 'clear',
          storeOp: 'store',
          view: context.getCurrentTexture().createView(),
        },
      ],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(renderPipeline);
    passEncoder.setVertexBuffer(0, vertexBuffer);
    passEncoder.draw(3);
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
  }
}



function doTest2() {

  // const func = new FunctionExpression(
  //   'something',
  //   [
  //     {identifier: 'a', typeSpec: typeSpecFromPrimitive(PrimitiveType.Int)},
  //     {identifier: 'b', typeSpec: typeSpecFromPrimitive(PrimitiveType.Int)},
  //   ],
  //   typeSpecUnknown(),
  //   [],
  //   [
  //     // new ReturnStatementExpression(
  //     //   new BinaryOpExpression(
  //     //     BinaryOpType.Add,
  //     //     new AliasRefExpression('a', 0),
  //     //     new AliasRefExpression('b', 0),
  //     //   ),
  //     // ),
  //   ],
  // );




//   const code = `
// interface float3 {
//   x: number;
//   y: number;
//   z: number;
// }


// // const x: float3 = { x: 0, y: 0, z: 0, };
// const x: float3;
// const y: float3 = { x: 0, y: 0, z: 0, };
// x.y = 1 + (2 / 3);

// // const z = x + y;
//   `;
//   const code = `
// 1 + (2 / 3);
//   `;


//   const code = `
// interface float3 {
//   x: number;
//   y: number;
//   z: number;
// }

// function funcSomething(a: number, b: boolean): number {
//   const c = 123;
//   if (a > c || false) {
//     return 3;
//   }
//   return (1 + (2 + 3));
// }
// function otherFunc(a: number): boolean {
//   const vec: float3 = { x: 1, y: 2, z: 3 };
//   return funcSomething(a + vec.x, true) > 3;
// }
// `;

//   const code = `
// // interface A {
// //   field0: number;
// //   field1: number;
// // }

// class float3 {
//   public w: number = 0;

//   constructor(
//     public x: number,
//     public y: number,
//     public z: number,
//   ) {
//     this.w = 2345;
//   }

//   operatorAdd(lhs: float3, rhs: float3): float3 { return new float3(0, 0, 0); }
// }

// class otherSomething {
//   public w: number = 0;

//   constructor(
//     public x: number,
//     public y: number,
//     public z: number,
//   ) {
//     this.w = 2222;
//   }

//   operatorAdd(lhs: float3, rhs: float3): float3 { return new float3(0, 0, 0); }
// }

// // function funcSomething(a: number, b: number): A {
// //   return { field0: a, field1: b };
// // }
// function otherFunc(a: number): boolean {
//   const arrayRef: number[]: [];

//   const lhs: float3 = new float3(1, 2, 3);
//   const rhs: float3 = new float3(4, 5, 6);
//   const result = lhs + rhs;

//   // const a = funcSomething(1, 2);
// }
// `;


//   const code = `
// function otherFunc(a: number): boolean {
//   const arrayRef: number[]: [ 1, 2, 3 ];
//   arrayRef;
// }
// `;

//   const code = `
// interface Generic<T> {
//   x: T;
// }

// function genericFunc2<T>(a: Generic<Generic<T>>): boolean {
//   a.x = a.x;
//   return false;
// }

// function genericFunc<T>(a: Generic<T>): boolean {
//   a.x = a.x;
//   return genericFunc2({ x: a });
// }

// function otherFunc() {
//   genericFunc({ x: 1234 });
//   genericFunc({ x: false });
//   genericFunc({ x: false });
//   genericFunc({ x: false });
// }

// // function otherFunc(a: number): boolean {
// //   const something: Generic<number> = { x: 1234 };
// //   const somethingBool: Generic<boolean> = { x: true };
// //   // const arrayRef: Array<number> = [ 1, 2, 3 ];
// //   const arrayRef: number[] = [ 1, 2, 3 ];
// //   // arrayRef.push(4);
// //   // const a = 123;
// //   // const b = a;
// //   // const c = b.toString();
// // }
// `;

//   const code = `

// function usesUnion() {
//   // const a: number = 1 + 2;
//   let a: boolean|number = 0;
//   if (a === 0) {
//     a = false;
//   }
// }

// `;

//   const code = `
// interface A {
//   x: number;
//   y: number;
// }
// interface B {
//   x: number;
//   y: number;
//   z: number;
// }

// function funcSomething(a: A): A|undefined {
//   if (a.x == 0) {
//     const result: A = { x: 1, y: 2, };
//     return result;
//   }
//   if (a.x == 1) {
//     const result: B = { x: 1, y: 2, z: 3 };
//     return result;
//   }
//   return undefined;
// }
// function funcSomething2(): A {
//   const inner = funcSomething({ x: 1, y: 2 });
//   if (inner) {
//     return inner;
//   }
//   return { x: 3, y: 4 };
// }
// `;

//   const code = `

// function funcA() {
//   funcB(1);
//   funcB(false);
// }

// function funcB<T>(a: T) {
//   return a;
// }

// `;

//   const code = `
// class A {
//   x: number = 1234;
//   b: B = new B();

//   instanceMethod() {
//     return this.x;
//   }

//   instanceMethodWithParam(y: number) {
//     return this.x + y;
//   }
// }
// class B {
//   z: number = 1234;

//   instanceMethodInInstance() {
//     return this.z;
//   }

//   instanceMethodInInstanceWithParam(y: number) {
//     return this.z + y;
//   }
// }

// function staticFunction() {
//   return 1324;
// }

// function someFunc() {
//   const a = new A();
//   a.instanceMethod();
//   a.instanceMethodWithParam(1234);
//   a.b.instanceMethodInInstance();
//   a.b.instanceMethodInInstanceWithParam(1234);
//   staticFunction();
// }
// `;

//   const code = `
// class A<T> {
//   value: T;

//   method() {
//     const inner: T = this.value;
//     return this.value;
//   }

//   constructor(v: T, public a: number) {
//     this.value = v;
//     a + a;
//   }
// }

// function someFunc() {
//   const a = new A<number>(1234, 1234);
//   a.value = 222;
//   a.method();
// }

// `;

// const code = `

// function someFunc() {
//   const array: Array<boolean> = new Array<boolean>(12);
//   array.at(123);
//   const l = array.length;
//   const a: float3 = new float4(3, new float3(3));
//   const b = a.zyx;
//   a.xyz = new float3(123);
//   // const boolVec: boolean4 = boolean4.zero;
//   // const t: Texture = new Texture(60, 70);
//   // // const a: int2 = new int2();
//   // // const b: float2 = new float2();
//   // const c = t.sample<NormalizedCoordMode, LinearFilterMode, ClampToEdgeAddressMode>(new float2(1, 2));
// }

// `;

const code = `

interface TriangleVertex {
  /* @position */ position: float4;
  color: float4;
}

function gpuTest(value: float): float {
  return value + 0.1;
}

function computeShader(threadId: int, options: { positions: TriangleVertex[] }) {
  const positions = options.positions;
  // positions[0] = { position: new float4(0, 0, 0, 1), color: new float4(0, 0, 1, 1) };
  // positions[1] = { position: new float4(1, 0, 0, 1), color: new float4(1, 0, 1, 1) };
  // positions[2] = { position: new float4(1, 1.1, 0, 1), color: new float4(1, 1, 1, 1) };
  // positions[0] = { position: new float4(0, 0, 0, 1), color: new float4(0, 0, 1, 1) };
  // positions[1] = { position: new float4(1, 0, 0, 1), color: new float4(1, 0, 1, 1) };
  // positions[2] = { position: new float4(1, 1.1, 0, 1), color: new float4(1, 0.6, 1, 1) };
  const p = positions[2];
  p.color.x = p.color.x + 1;
  positions[2] = p;
  // positions[2].color.x = positions[2].color.x + 1;
}

@vertexShader
function vertexShader(position: TriangleVertex, threadId: int, options: { placeholder: float }): TriangleVertex {
  return position;
}
@fragmentShader
function fragmentShader(position: TriangleVertex, threadId: int, options: { alpha: float, beta: float, other: { theta: float }, color: float4, someBuf: TriangleVertex[] }): float4 {
  let color = position.color;
  // const bufValue = options.someBuf[0].position.x;
  // const lenValue = options.someBuf.length;
  // color.x = gpuTest(options.alpha) / options.beta + options.other.theta;
  // color = color * 5.0 + (-color) * 4.0;
  return color;
}
function test() {}
function drawTriangle() {
  test();
  // @vertexShader
  // function vertexShader(position: TriangleVertex, threadId: int, options: { placeholder: float }): TriangleVertex {
  //   return position;
  // }
  // @fragmentShader
  // function fragmentShader(position: TriangleVertex, threadId: int, options: { alpha: float }): float4 {
  //   const color = position.color;
  //   color.a = options.alpha;
  //   return color;
  // }

  const positions: TriangleVertex[] = Array.persistent<TriangleVertex>(3);
  // positions.push({ position: new float4(0, 0, 0, 1), color: new float4(0, 0, 1, 1) });
  // positions.push({ position: new float4(1, 0, 0, 1), color: new float4(1, 0, 1, 1) });
  // positions.push({ position: new float4(1, 1.1, 0, 1), color: new float4(1, 1, 1, 1) });
  positions.push({ position: new float4(0.25, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  positions.push({ position: new float4(1, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  positions.push({ position: new float4(0.5, 0.5, 0, 1), color: new float4(0, 0, 0, 1) });
  // positions[0].position.x = 0.4;
  // positions[1].position.x = 0.9;
  // const positions = generateTriangleVertices(10);
  // for (let i = 0; i < positions.length; i = i + 1) {
  for (const v of positions) {
    float4.operatorAdd(v.position, v.position);
    // v.position = v.position * 0.5;
    // v.position.x = v.position.x * 0.5;
    // positions[i].position.y = positions[i].position.y * 0.5;
  }
  // let i = 0;
  // while (i < positions.length) {
  //   const v = positions[i];
  //   v.position.x = v.position.x * 0.5;
  //   // positions[i].position.y = positions[i].position.y * 0.5;
  //   i = i + 1;
  // }

  Gpu.compute(1, computeShader)({ positions: positions });

  Gpu.renderElements
      (positions.length, vertexShader, fragmentShader)
      (positions, { placeholder: 0.2 })
      ({ alpha: 0.9, beta: 1.8, other: { theta: 2.0 }, color: new float4(1, 1, 1, 1), someBuf: positions });
}
`;


// const code = `
// function drawTriangle() {
//   const lhs = new float4(1, 1, 1, 1);
//   const rhs = new float4(1, 1, 1, 1);
//   const a: float4 = lhs + rhs;
//   const b: float4 = a * 5.0 - 4.0;
//   const c = b * 5.0 - 4.0;
// }
// `;


// const code = `

// function otherFunc(a: int): int {
//   return a;
// }

// function someFunc() {
//   otherFunc(1234 + 2);
// }

// `;





//   const code = `
// class A {
//   value: number;

//   method() {
//     const inner: number = this.value;
//     return this.value;
//   }

//   constructor(v: number, a: number) {
//     this.value = v;
//     a + a;
//   }
// }

// function someFunc() {
//   const a = new A(1234, 1234);
//   a.value = 222;
//   a.method();
// }
// `;


  bop.compile(code);

  // const a: float3 = new float4(3, new float3(3));
  // a.xyz = 123;
  // const boolVec: boolean4 = boolean4.zero;
  // const t: Texture = new Texture(60, 70);
  // const c = t.sample<NormalizedCoordMode, LinearFilterMode, ClampToEdgeAddressMode>(new float2(1, 2));


//   const code = `

// function something(a: number, b: number) {
//   let result;
//   // result: any
//   if (a > 0) {
//     result = 'asdf';
//   } else {
//     result = 0;
//   }
//   // result: string|number
//   console.log(result);
//   if (b > 0) {
//     result = 1;
//   } else {
//     result = 2;
//   }
//   // result: number
//   return result + a + b;
// }

// function add<T>(a: T, b: T) {
//   return a + b;
// }

// `;









}

@customElement('nano-app')
export class NanoApp extends LitElement {
  static instance?: NanoApp;

  @query('#query-input') queryInputElement!: HTMLInputElement;
  @query('#gpu-canvas') gpuCanvas!: HTMLCanvasElement;
  @property() overlay?: Overlay;
  @property() windowActive = true;
  @observable dragDropState = DragDropState.NotStarted

  readonly commandParser = new CommandParser(getCommands(this));

  constructor() {
    super();
    NanoApp.instance = this;
    const thisCapture = this;

    makeObservable(this);

    const browserWindow = getBrowserWindow();
    if (browserWindow) {
      browserWindow.onDidActiveChange = (active) => this.windowActive = active;
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    adoptCommonStyleSheets(this);

    window.addEventListener('keydown', this.onWindowKeydown.bind(this));
    window.addEventListener('keypress', this.onWindowKeypress.bind(this));
    window.addEventListener('contextmenu', this.onWindowRightClick.bind(this));
    window.addEventListener('drop', this.doDragDropDrop.bind(this));
    window.addEventListener('dragover', this.doDragDropDragOver.bind(this));
    window.addEventListener('dragleave', this.doDragDropDragLeave.bind(this));

    setTimeout(() => {
      doTest(this.gpuCanvas);
    });
  }

  @action
  doNothing() {}

  @observable queryInputForceShown = false;
  private requestFocusQueryInput = false;
  private queryPreviewing?: CandidateCompletion = undefined;
  @observable.shallow completions: CandidateCompletion[] = [];

  @action
  private doToggleQueryInputField(state?: boolean, initialQuery?: string) {
    this.overlay = undefined;
    const newState = state ?? !this.queryInputForceShown;
    if (newState === this.queryInputForceShown) {
      return;
    }
    this.queryInputForceShown = newState;
    if (this.queryInputForceShown) {
      if (initialQuery !== undefined) {
        if (initialQuery === '') {
          this.doSearchClear();
        }
        this.queryInputElement.value = initialQuery;
      }
      this.queryChanged();
      this.requestFocusQueryInput = true;
    } else {
      if (!this.isQueryInputVisible()) {
        this.doSearchCancelPreview();
      }
    }
  }

  @action
  private queryChanged() {
    const query = this.queryInputElement.value;
    let completions = this.commandParser.parse(query, true);
    const toPreview = completions.find(entry => entry.isComplete);

    completions = completions.filter(entry => !entry.isComplete);
    if (query.trim().length === 0) {
      completions = completions
          .concat(this.commandParser.parse('cmd:'));
    }

    let backQuery = query.trimEnd();
    if (backQuery.at(backQuery.length - 1) === ':') {
      backQuery = backQuery.substring(0, backQuery.length - 1);
    }
    while (backQuery.length > 0) {
      const lastChar = backQuery[backQuery.length - 1];
      if (lastChar === ':' || lastChar.trim().length === 0) {
        break;
      }
      backQuery = backQuery.substring(0, backQuery.length - 1);
    }
    backQuery = backQuery.trimEnd();

    completions.push({
      isComplete: false,
      byCommand: {
        name: 'back',
        desc: 'back',
        atomPrefix: '←',
        argSpec: [],
      },
      resultQuery: backQuery,
    });
    this.completions = completions;

    if (this.queryPreviewing?.forCommand && this.queryPreviewing?.resolvedArgs) {
      this.queryPreviewing.forCommand.cancelPreviewFunc?.(
          this.queryPreviewing.forCommand, this.queryPreviewing.resolvedArgs);
    }
    this.queryPreviewing = toPreview;
    if (this.queryPreviewing) {
      if (this.queryPreviewing?.forCommand && this.queryPreviewing?.resolvedArgs) {
        this.queryPreviewing.forCommand.beginPreviewFunc?.(
            this.queryPreviewing.forCommand, this.queryPreviewing.resolvedArgs);
      }
    }
  }

  @action
  private acceptQueryCompletion(completion: CandidateCompletion) {
    if (completion.resultQuery !== undefined) {
      this.queryInputElement.value = completion.resultQuery;
      this.queryChanged();
      if (completion.forCommand?.executeOnAutoComplete) {
        this.doExecuteQuery();
      }
    }
  }

  @action
  private doExecuteQuery() {
    if (this.queryPreviewing?.forCommand && this.queryPreviewing?.resolvedArgs) {
      this.queryPreviewing.forCommand.cancelPreviewFunc?.(
          this.queryPreviewing.forCommand, this.queryPreviewing.resolvedArgs);
    }
    this.queryPreviewing = undefined;

    const query = this.queryInputElement.value;
    const result = this.commandParser.execute(query);
    if (result) {
      this.queryInputElement.value = '';
      this.queryChanged(); // HACK!!!
      this.queryInputForceShown = false;
    } else {
      if (query.trim().length === 0) {
        this.queryInputElement.value = '';
        this.queryChanged(); // HACK!!!
        this.doSearchClear();
        this.queryInputForceShown = false;
      }
    }
  }

  @action
  private queryAreaKeypress(e: KeyboardEvent) {
    console.log(e);
    const currentQuery = this.queryInputElement.value;
    const queryIsDefault = !currentQuery || currentQuery.trim() === 'cmd:';
    if ((e.key === '/' || e.key === '?') && queryIsDefault) {
      e.preventDefault();
      this.doToggleQueryInputField(false);
    }
    e.stopPropagation();
  }

  @action
  private queryAreaKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.doToggleQueryInputField(false);
    }
    e.stopPropagation();
  }

  @action
  private queryKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.doExecuteQuery();
    }
  }

  @action
  onCompletionChipClicked(e: MouseEvent, c: CandidateCompletion) {
    if (e.button !== 0) {
      return;
    }
    this.acceptQueryCompletion(c);
  }

  private isQueryInputVisible(): boolean {
    return this.queryInputForceShown;
  }

  private isQueryUnderlayVisible(): boolean {
    return this.completions.length !== 0 || this.searchPreviewQuery.length === 0 || this.queryInputElement.value.length <= 3;
  }

  @action
  onQueryUnderlayClicked() {
    this.doToggleQueryInputField(false);
  }

  private searchAcceptedQuery: QueryToken[] = [];
  private searchPreviewQuery: QueryToken[] = [];
  private prevSearchQuery: QueryToken[] = [];
  private readonly searchUpdateQueue = new utils.OperationQueue();

  @action
  doSearchAccept(command: CommandSpec, args: CommandResolvedArg[]) {
    const query = this.searchQueryFromArgs(args);
    this.searchAcceptedQuery = query;
    console.log(`do search: ${query.join(' ')}`);
    this.updateDatabaseSearchQuery();
  }

  @action
  doSearchClear() {
    this.searchAcceptedQuery = [];
    this.searchPreviewQuery = [];
    this.prevSearchQuery = [];
    this.updateDatabaseSearchQuery();
  }

  @action
  doSearchBeginPreview(command: CommandSpec, args: CommandResolvedArg[]) {
    const query = this.searchQueryFromArgs(args);
    this.searchPreviewQuery = query;
    console.log(`do preview: ${this.searchQueryToString(query)}`);
    this.updateDatabaseSearchQuery();
  }

  @action
  doSearchCancelPreview() {
    this.searchPreviewQuery = [];
    this.updateDatabaseSearchQuery();
  }

  private updateDatabaseSearchQuery(shortWaitCount = 0) {
    this.searchUpdateQueue.push(async () => {
      await utils.sleep(0);
      let nextQuery = this.searchAcceptedQuery;
      if (this.searchPreviewQuery.length > 0) {
        nextQuery = this.searchPreviewQuery;
      }
      const newQueryStr = this.searchQueryToString(nextQuery);
      const oldQueryStr = this.searchQueryToString(this.prevSearchQuery);
      if (newQueryStr === oldQueryStr) {
        return;
      }
      if (shortWaitCount < 4 && nextQuery.length > 0 && newQueryStr.length < 3) {
        await utils.sleep(50);
        this.updateDatabaseSearchQuery(shortWaitCount + 1);
        return;
      }
      this.prevSearchQuery = nextQuery;
      // Database.instance.setSearchQuery(nextQuery);
      await utils.sleep(100);
    });
  }

  private searchQueryFromArgs(args: CommandResolvedArg[]): QueryToken[] {
    return Array.from(utils.filterNulllike(args.map(arg => {
      if (arg.subcommand) {
        const subtoken = arg.subcommand.command.valueFunc?.(arg.subcommand.command, arg.subcommand.args) as QueryToken;
        if (subtoken) {
          return subtoken;
        }
      }
      const stringlike = arg.oneofValue ?? arg.stringValue;
      if (stringlike) {
        return {text: stringlike};
      }
      return undefined;
    })));
  }

  private searchQueryToString(queryTokens: QueryToken[]) {
    return queryTokens.map(token => token.atom ? `${token.atom}:${token.text}` : token.text).join(' ');
  }

  searchQueryTokenFromAtomFunc(atom: QueryTokenAtom): (text: string) => QueryToken {
    return (text) => utils.upcast({ text, atom });
  }

  @action
  private onWindowKeydown(e: KeyboardEvent) {
    let captured = true;
    if (e.key === 'Escape') {
      if (this.overlay) {
        this.closeOverlay();
      } else {
        this.doToggleQueryInputField();
      }
    } else {
      captured = false;
    }
    if (captured) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  @action
  private onWindowKeypress(e: KeyboardEvent) {
    let captured = true;
    console.log(e);
    const isNoModifier = !e.metaKey && !e.ctrlKey && !e.altKey;
    const isCtrlOption = e.metaKey || e.ctrlKey || e.altKey;
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.doToggleQueryInputField(true, '');
    } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.doToggleQueryInputField(true, 'cmd:');
    } else {
      captured = false;
    }
    if (captured) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  @action
  private onWindowRightClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.doToggleQueryInputField(undefined, '');
  }

  private isInDragDrop = false;

  @action
  private async doDragDropDrop(e: DragEvent) {
    if (this.isInDragDrop) {
      this.overlay = Overlay.DragDropAccept;
      this.isInDragDrop = false;
      this.dragDropState = DragDropState.NotStarted;
      setTimeout(() => {
        if (this.overlay === Overlay.DragDropAccept) {
          this.overlay = undefined;
        }
      }, 1200);
    }

    try {
      e.preventDefault();
      if (!e.dataTransfer?.files) {
        return;
      }
      const fileHandles = await handlesFromDataTransfer(e.dataTransfer);

      for (const fileHandle of fileHandles) {
        console.log(fileHandle);
      }
      this.dragDropState = DragDropState.Success;
    } catch (e) {
      console.log(e);
      this.dragDropState = DragDropState.Failure;
    }
  }

  @action
  private doDragDropDragOver(e: DragEvent) {
    if (e.dataTransfer?.files) {
      e.preventDefault();
      // TODO: Consider making overlay stack.
      this.overlay = Overlay.DragDropAccept;
      this.isInDragDrop = true;
      this.dragDropState = DragDropState.NotStarted;
    }
  }

  @action
  private doDragDropDragLeave(e: DragEvent) {
    // TODO: Consider making overlay stack.
    this.overlay = undefined;
    this.isInDragDrop = false;
    this.dragDropState = DragDropState.NotStarted;
  }

  @action
  closeOverlay() {
    this.overlay = undefined;
  }

  private overlayStopPropagation(e: Event) {
    e.stopPropagation();
  }

  private renderAutorunDisposer = () => {};
  private renderAutorunDirty = true;
  private renderIsInRender = false;
  private renderAutorunResult = html``;

  protected override update(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
    if (changedProperties.size > 0) {
      this.renderAutorunDirty = true;
    }
    super.update(changedProperties);
  }

  override render() {
    this.renderIsInRender = true;
    if (this.renderAutorunDirty) {
      this.renderAutorunDisposer?.();
      this.renderAutorunDisposer = autorun(() => {
        this.renderAutorunDirty = false;
        this.renderAutorunResult = this.renderInner();
        if (!this.renderIsInRender) {
          this.requestUpdate();
        }
      });
    }
    this.renderIsInRender = false;
    return this.renderAutorunResult;
  }

  renderInner() {
    return html`
<div
    class=${classMap({
      'app': true,
      'window-active': this.windowActive,
      'window-deactive': !this.windowActive,
    })}>
  ${this.renderTitleBar()}
  <div>
    <canvas id="gpu-canvas"></canvas>
  </div>
  <div class="tracks-view-area">
    <recycler-view class="tracks-view" id="track-list-view"></recycler-view>
    ${this.renderQueryOverlay()}
    ${this.renderOverlay()}
  </div>
</div>
`;
  }

  private renderTitleBar() {
    if (!environment.isElectron()) {
      return html``;
    }
    return html`
<div class="window-title-bar">
  <div class="window-title-text-container">
    <div class="window-title-text-part">nano-bus</div>
    <div class="window-title-text-part" style="overflow: visible; position: relative; left: -0.75em; display: flex;">
      <simple-icon style="color: inherit; font-size: 18px;" icon="bolt"></simple-icon>
    </div>
  </div>
  <div class="window-title-divider"></div>
</div>
    `;
  }

  private renderOverlay() {
    if (this.overlay === undefined) {
      return html``;
    }
    return html`
<div class="overlay-container" @keypress=${this.overlayStopPropagation} @keydown=${this.overlayStopPropagation}>
  <div class="overlay-underlay" @click=${this.closeOverlay}></div>
  <div class="overlay-content">
    ${this.renderOverlayContent()}
  </div>
</div>
`;
  }

  private renderOverlayContent() {
    if (this.overlay === Overlay.DragDropAccept) {
      return html`
<div class="screaming-headline-text">
  <div>Drop files to add</div>
  <div>
    <simple-icon icon=${this.dragDropState === DragDropState.Success ? 'check-circle' : this.dragDropState === DragDropState.Failure ? 'exclamation-circle' : 'bolt'}></simple-icon>
  </div>
</div>
`;
    }
    return html``;
  }

  private renderQueryOverlay() {
    return html`
<div class=${classMap({
        'query-container': true,
        'hidden': !this.isQueryInputVisible() || this.overlay !== undefined,
    })}>
  <div class=${classMap({
        'query-input-underlay': true,
        'hidden': !this.isQueryUnderlayVisible(),
    })}
      @click=${this.onQueryUnderlayClicked}>
  </div>
  <div class="query-input-overlay">
    <div class="query-input-area" @keypress=${this.queryAreaKeypress} @keydown=${this.queryAreaKeydown}>
      <input id="query-input" class="query-input" @input=${this.queryChanged} @keypress=${this.queryKeypress}></input>
      <div class="query-input-icon"><simple-icon icon="bolt"></simple-icon></div>
    </div>
    <div class="query-completion-area">
      ${this.completions.map(c => html`
        <div
            class=${classMap({
              'query-completion-chip': true,
              'click-target': true,
              'special': getChipLabel(c) || false,
            })}
            @click=${(e: MouseEvent) => this.onCompletionChipClicked(e, c)}>
          <div class="query-completion-chip-label">${c.byCommand?.atomPrefix === '←' ? html`<simple-icon style="font-size: 120%;" icon="arrow-left"></simple-icon>` : c.byValue ?? c.byCommand?.atomPrefix ?? '<unknown>'}</div>
          <div class="query-completion-chip-tag">${getChipLabel(c)}</div>
        </div>
      `)}
    </div>
  </div>
</div>
    `;
  }

  protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
    super.updated(changedProperties);

    if (this.requestFocusQueryInput) {
      this.queryInputElement.focus();
    }
  }
}

function getChipLabel(c: CandidateCompletion): string|undefined {
  if (c.forCommand?.chipLabel) {
    return c.forCommand?.chipLabel;
  }
  if (c.forCommand && c.resolvedArgs) {
    return c.forCommand.chipLabelFunc?.(c.forCommand, c.resolvedArgs)
  }
  return undefined;
}










