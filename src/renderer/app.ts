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



















function doTest() {

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
  /* @position */ position: float2;
  color: float4;
}

function gpuTest(value: float) {
  return value + 1;
}

@vertexShader
function vertexShader(position: TriangleVertex, threadId: int, options: { placeholder: float }): TriangleVertex {
  return position;
}
@fragmentShader
function fragmentShader(position: TriangleVertex, threadId: int, options: { alpha: float }): float4 {
  const color = position.color;
  color.a = gpuTest(options.alpha);
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
  positions.push({ position: new float2(0, 0), color: new float4(0, 0, 1, 1) });
  positions.push({ position: new float2(1, 0), color: new float4(1, 0, 1, 1) });
  positions.push({ position: new float2(1, 1), color: new float4(1, 1, 1, 1) });
  // const positions = generateTriangleVertices(10);

  Gpu.renderElements(positions.length, vertexShader, fragmentShader)(positions, { placeholder: 1 })({ alpha: 0.5 });
}
`;



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
    doTest();
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










