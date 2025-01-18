import { html, LitElement, PropertyValueMap } from 'lit';
import {} from 'lit/html';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { action, autorun, observable, makeObservable, runInAction } from 'mobx';
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

const initialCode = `
interface A {
  fieldA: number;
  fieldB: B;
}
interface B {
  fieldA: number;
}

function test() {
  const a: A = { fieldA: 1, fieldB: { fieldA: 2 } };
  a.fieldA = 1234;
  a.fieldB.fieldA = 1234;
  a.fieldB = { fieldA: 5432 };
  return 8 + 2 + a.fieldA;
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

    setTimeout(async () => {
      const webGpuContext = this.gpuCanvas.getContext("webgpu")!;
      SharedMTLInternals().setTargetCanvasContext(webGpuContext);

      const fullCode = initialCode;
      const codeLines = fullCode.split('\n');
      const compileResult = await bop.compile(fullCode);
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










