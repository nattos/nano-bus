import { html, LitElement, PropertyValueMap } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { action, autorun, observable, makeObservable, runInAction } from 'mobx';
import * as utils from '../utils';
import * as bap from './bap';
import { SharedMTLInternals } from './runtime/bop-javascript-lib';

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


const initialCode2 = `

interface TriangleVertex {
  /* @position */ position: float4;
  color: float4;
}

function gpuTest(value: float): float {
  return value + 0.1;
}

function computeShader(threadId: int, options: { positions: TriangleVertex[], texture: Texture }) {
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
  positions[2].color.x = positions[2].color.x + 1;
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

  const tex = Texture.persistent(128, 128);

  const positions: TriangleVertex[] = Array.persistent<TriangleVertex>(3);
  // positions.push({ position: new float4(0, 0, 0, 1), color: new float4(0, 0, 1, 1) });
  // positions.push({ position: new float4(1, 0, 0, 1), color: new float4(1, 0, 1, 1) });
  // positions.push({ position: new float4(1, 1.1, 0, 1), color: new float4(1, 1, 1, 1) });
  // positions.push({ position: new float4(0.25, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  // positions.push({ position: new float4(1, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  // positions.push({ position: new float4(0.5, 0.5, 0, 1), color: new float4(0, 0, 0, 1) });
  positions[0] = ({ position: new float4(0.25, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  positions[1] = ({ position: new float4(1, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  positions[2] = ({ position: new float4(0.5, 0.5, 0, 1), color: new float4(0, 0, 0, 1) });
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

  Gpu.compute(1, computeShader)({ positions: positions, texture: tex });

  Gpu.renderElements
      (positions.length, vertexShader, fragmentShader)
      (positions, { placeholder: 0.2 })
      ({ alpha: 0.9, beta: 1.8, other: { theta: 2.0 }, color: new float4(1, 1, 1, 1), someBuf: positions });
}
`;

const initialCode3 = `
function test() {
  for (let i = 0; i < 5; i = i + 1) {
    for (let j = 0; j < 5; j = j + 1) {
      if (j > 1234) {
        return 3;
      }
    }
  }
}
`;

const initialCode4 = `
function test2() {
  return 1 + 2;
}
function test() {
  let a = 3;
  if (test2() + 4) {
    let b = 8;
    let c = a + 5 + b;
    if (true) {
      a = c;
    }
  }

  for (let i = 0; i < 5; i = i + 1) {
    a = i + a;
    if (i > 10) {
      break;
    }
    if (i < 5) {
      continue;
    }
    a = a + 1;
  }

  if (a + 6) {
    return 7 + a;
  }
}
`;

const initialCode5 = `
interface A {
  fieldA: float;
  fieldB: B;
}
interface B {
  fieldA: float;
}
interface C {
  fieldA: float;
}

function test(): int {
  const a: A = { fieldA: 1, fieldB: { fieldA: 2 } };
  const c: C = { fieldA: 1 };
  a.fieldA = 1234;
  a.fieldB.fieldA = 1234;
  a.fieldB = { fieldA: 5432 };
  return 8 + 2 + a.fieldA + c.fieldA;
}
`;

const initialCode6 = `
interface A<T> {
  fieldA: T;
  fieldB: B<T>;
}
interface B<T> {
  fieldA: T;
}
interface C {
  fieldC: number;
}

function test2(a: number): number {
  return a + 1;
}

function test() {
  const x: float4 = new float4();
  1 + x.x;
  // const a: A<number> = { fieldA: 1, fieldB: { fieldA: 2 } };
  // a.fieldA = 1234;
  // a.fieldB.fieldA = 1234;
  // a.fieldB = { fieldA: 5432 };
  // return 8 + 2 + a.fieldA + test2(8766);
}
`;

const initialCode7 = `
function test() {
  const x: float4 = new float4(1, 2, 3, 4);
  const y = float4.one;
  // x.test(1);
  let a: number = 1 + x.x + y.y;
  return a;
}
`;

const initialCode8 = `
function test() {
  const a = Array.persistent<float4>(1234);
  a[0].x = 2;
  return 1;
}
`;

const initialCode = `
interface TriangleVertex {
  /* @position */ position: float4;
  color: float4;
}

@vertexShader
function vertexShader(position: TriangleVertex, threadId: int, options: { placeholder: float }): TriangleVertex {
  return position;
}
@fragmentShader
function fragmentShader(position: TriangleVertex, options: { alpha: float, beta: float, other: { theta: float }, color: float4, someBuf: TriangleVertex[] }): float4 {
  let color = position.color;
  // const bufValue = options.someBuf[0].position.x;
  // const lenValue = options.someBuf.length;
  // color.x = gpuTest(options.alpha) / options.beta + options.other.theta;
  // color = color * 5.0 + (-color) * 4.0;
  color = color + options.color;
  return color;
}

function test() {
  // const v: TriangleVertex = { position: new float4(0.25, 0.25, 0, 1), color: new float4(0, 0, 0, 1) };
  // v.position = new float4(1, 2, 3, 4);
  // v.position.x += 1;
  // v.position.x++;
  const positions: TriangleVertex[] = Array.persistent<TriangleVertex>(3);
  positions[0] = ({ position: new float4(0.25, 0.25, 0, 1), color: new float4(0, 0, 0, 1) });
  positions[1] = ({ position: new float4(1, 0.25, 0, 1), color: new float4(1, 0, 0, 1) });
  positions[2] = ({ position: new float4(0.5, 0.5, 0, 1), color: new float4(0, 0, 0, 1) });
  positions[0].position.x = 1.0;

  Gpu.renderElements
      (positions.length, vertexShader, fragmentShader)
      (positions, { placeholder: 0.2 })
      ({ alpha: 0.9, beta: 1.8, other: { theta: 2.0 }, color: new float4(0.1, 0.2, 0.3, 0.0), someBuf: positions });
}
`;



interface CodeLine {
  code: string;
  debugInValues: number[];
  debugOutValues: number[];
}

@customElement('nano-app')
export class NanoApp extends LitElement {
  static instance?: NanoApp;

  @query('#query-input') queryInputElement!: HTMLInputElement;
  @query('#gpu-canvas') gpuCanvas!: HTMLCanvasElement;
  @property() overlay?: Overlay;
  @property({ attribute: false }) windowActive = true;
  @observable dragDropState = DragDropState.NotStarted;

  @observable codeLines: CodeLine[] = [];

  constructor() {
    super();
    NanoApp.instance = this;
    makeObservable(this);
  }

  connectedCallback(): void {
    super.connectedCallback();

    // TEST CODE!
    setTimeout(async () => {
      const webGpuContext = this.gpuCanvas.getContext("webgpu")!;
      SharedMTLInternals().setTargetCanvasContext(webGpuContext);

      const fullCode = initialCode;
      const codeLines = fullCode.split('\n');
      const compileResult = await bap.compile(fullCode);
      await compileResult.frameRunner.runOneFrame();
      console.log('done compileResult.frameRunner.runOneFrame()');
      await compileResult.frameRunner.runOneFrame();
      console.log('done compileResult.frameRunner.runOneFrame()');
      await compileResult.frameRunner.runOneFrame();
      console.log('done compileResult.frameRunner.runOneFrame()');
      await compileResult.frameRunner.runOneFrame();
      console.log('done compileResult.frameRunner.runOneFrame()');
      runInAction(() => {
        this.codeLines.splice(0);
        this.codeLines.push(...codeLines.map((codeLine) => ({
          code: codeLine,
          debugInValues: [],
          debugOutValues: [0],
        })));
      });
    });
  }

  render() {
    return html`
<div class="app">
  <div>
    <canvas id="gpu-canvas"></canvas>
  </div>
</div>
`;
  }
}
