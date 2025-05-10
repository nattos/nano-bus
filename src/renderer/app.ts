import { html, LitElement, PropertyValueMap } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { action, autorun, observable, makeObservable, runInAction } from 'mobx';
import * as utils from '../utils';
import * as bap from './bap';
import { SharedMTLInternals } from './runtime/bop-javascript-lib';

interface CodeLine {
  code: string;
  debugInValues: number[];
  debugOutValues: number[];
}

@customElement('nano-app')
export class NanoApp extends LitElement {
  static instance?: NanoApp;

  @query('#gpu-canvas') gpuCanvas!: HTMLCanvasElement;

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

      // const fullCode = initialCode;
      const fullCode = await (await fetch('libcode/testcode/test.ts')).text();
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
