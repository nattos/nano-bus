import './device-editor-panel';
import './device-view';
import './editor-panels-view';
import './inspector-editor-panel-view';
import './monitor-editor-panel';
import './value-slider';

import * as utils from '../../utils';
import * as idb from 'idb';
import { css, html, LitElement, PropertyValueMap } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { action, autorun, observable, makeObservable, runInAction } from 'mobx';
import { CodeRef, DeviceDecl, DeviceLayout, PinDecl, TypeAssignable, TypeSpec } from './device-layout';
import { EditOperation } from './edit-operation';
import { moduleFromJson, ModuleLayout, moduleToJson } from './module-layout';
import { isTrackLane, TrackLaneLayout } from './track-lane-layout';
import { InterconnectLayout, PathPoint } from './interconnect-layout';
import { canonical, view } from './utils';
import { APP_STYLES } from './app-styles';
import { cssColorFromHash, getPathPointXY } from './layout-utils';
import { MultiMap, ShadowMap, ShadowSet, syncLists, SyncListsAccessors } from '../collections';
import { DeviceView } from './device-view';
import { LaneLayout } from './lane-layout';
import { BusLaneLayout, isBusLane } from './bus-lane-layout';
import { PinLayout } from './pin-layout';
import { EditorPanelsView } from './editor-panels-view';
import { DeviceEditorPanel } from './device-editor-panel';
import { InspectorEditorPanel } from './inspector-editor-panel-view';
import { MonitorEditorPanel } from './monitor-editor-panel';
import { SelectPaths } from './select-paths.ts';
import { splitStartsWith } from '../strings';
import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { BapStaticFunctionSignature, BapStaticType } from '../bap-exports';
import { BusBapCompiler, BusBapSerializedState } from './bus-bap';

interface ModuleExports {
  functions: BapStaticFunctionSignature[];
}

interface CodeLine {
  code: string;
  debugInValues: number[];
  debugOutValues: number[];
}

const COMPILE_CACHE_OBJECT_STORE = 'compile-cache';
const MODULE_STATES_OBJECT_STORE = 'module-states';
const COMPILE_CACHE_VERSION = '1';

@customElement('bus-view')
export class BusView extends MobxLitElement {
  static readonly styles = [APP_STYLES];
  static instance?: BusView;

  readonly compiler = new BusBapCompiler();
  private readonly moduleExportsTask = new utils.WaitableValue<ModuleExports>({ functions: [] });

  readonly selectPaths = new SelectPaths();
  readonly monitorEditorPanel = new MonitorEditorPanel();
  readonly editorPanelsView = new EditorPanelsView({ selectPaths: this.selectPaths, });

  @observable codeLines: CodeLine[] = [];

  module = new ModuleLayout();
  readonly deviceMap = new ShadowSet<DeviceLayout, DeviceView>({ shadowType: (d) => new DeviceView(this, d) });
  private compileState: BusBapSerializedState = {};

  readonly ready;
  readonly localStore;
  private readonly ioTaskQueue = new utils.OperationQueue();

  constructor() {
    super();

    BusView.instance = this;
    makeObservable(this);

    this.localStore = (async () => {
      const localStore = await idb.openDB('nano-bus', 1, {
        upgrade(database) {
          database.createObjectStore(COMPILE_CACHE_OBJECT_STORE);
          database.createObjectStore(MODULE_STATES_OBJECT_STORE);
        },
      });
      return localStore;
    })();
    this.ready = (async () => {
      await this.loadCompileState();
    })();

    this.compiler.onStateChanged = (event) => {
      if (event.state.module) {
        this.moduleExportsTask.set(event.state.module.exports);
      }
      if (event.stateChanged) {
        this.compileState = event.state;
        this.saveCompileState();
      }
      if (event.frameRunner && event.frameRunnerChanged) {
        event.frameRunner.runnerFunc.runOneFrame();
      }
    };
  }

  private async loadCompileState() {
    await this.ioTaskQueue.push(async () => {
      const localStore = await this.localStore;
      const serialized: BusBapSerializedState|undefined =
          await localStore.get(COMPILE_CACHE_OBJECT_STORE, COMPILE_CACHE_VERSION);
      if (!serialized) {
        return;
      }
      this.compiler.deserialize(serialized);
      if (serialized.module) {
        this.moduleExportsTask.set(serialized.module.exports);
      }
    });
  }

  private async loadModuleState() {
    await this.ioTaskQueue.push(async () => {
      const localStore = await this.localStore;
      const serialized: string|undefined =
          await localStore.get(MODULE_STATES_OBJECT_STORE, 'mymodule');
      if (!serialized) {
        // TEST DATA.
        await this.ready; // Wait for DeviceDecls.
        this.module = makeTestData(this.moduleExportsTask.latestValue);
        return;
      }
      const restoredModule = moduleFromJson(serialized);
      this.module = restoredModule;
    });
  }

  private async saveCompileState() {
    await this.ioTaskQueue.push(async () => {
      const localStore = await this.localStore;
      const serialized = this.compileState ?? {};
      await localStore.put(COMPILE_CACHE_OBJECT_STORE, serialized, COMPILE_CACHE_VERSION);
    });
  }

  private async saveModuleState() {
    await this.ioTaskQueue.push(async () => {
      const localStore = await this.localStore;
      const serialized = moduleToJson(this.module);
      await localStore.put(MODULE_STATES_OBJECT_STORE, serialized, 'mymodule');
    });
  }

  connectedCallback(): void {
    super.connectedCallback();

    (async () => {
      await this.loadModuleState();

      this.moduleExportsTask.listen((moduleExports) => {
        using edit = this.startEdit();
        edit.write(() => {
          const { deviceDecls } = loadDeviceDecls(moduleExports);
          console.log('edit.applyDecls(deviceDecls)', deviceDecls);
          edit.applyDecls(Array.from(deviceDecls.values()));
        });
      });

      this.editorPanelsView.pushEditorPanel(this.monitorEditorPanel, { sticky: true });

      runInAction(() => {
        for (const device of this.module.allDevices) {
          const editPath = device.uniqueKey;
          this.selectPaths.definePath(device.uniqueKey, {
            renderEditorPanel: () => html`
              <bus-device-editor-panel
                  .editPath=${[editPath]}
                  .device=${device}
                  .selectPaths=${this.selectPaths}
                  >
              </bus-device-editor-panel>
            `,
            getChild: (part) => {
              const childPath = [editPath, part];
              const inPinIndex = utils.parseIntOr(splitStartsWith(part, 'inPin')?.tail);
              const outPinIndex = utils.parseIntOr(splitStartsWith(part, 'outPin')?.tail);
              if (inPinIndex !== undefined) {
                return {
                  renderEditorPanel: () => html`
                    <bus-inspector-editor-panel
                        .editPath=${childPath}
                        .value=${device.inPins[inPinIndex]?.source.editableValue}
                        .selectPaths=${this.selectPaths}
                      >
                    </bus-inspector-editor-panel>
                  `,
                };
              } else if (outPinIndex !== undefined) {
                return {
                  renderEditorPanel: () => html`
                    <bus-inspector-editor-panel
                        .editPath=${childPath}
                        .value=${device.outPins[outPinIndex]?.source.editableValue}
                        .selectPaths=${this.selectPaths}
                      >
                    </bus-inspector-editor-panel>
                  `,
                };
              }
            },
          });
        }
      });
      this.selectPaths.selectPath([ this.module.allDevices[1].uniqueKey, 'outPin0' ]);

      {
        // Find all nodes transitively connected to outputs.
        const sinkNode = this.module.allDevices.filter(d => d.decl.codeRef.identifier === 'textureOut');

        // First gather connections. This lets us smartly break cycles later.
        const inputsMap = new Map<DeviceLayout, DeviceLayout[]>();
        for (const device of this.module.allDevices) {
          const inputs: DeviceLayout[] = [];
          for (const inPin of device.inPins) {
            for (const interconnect of inPin.interconnects) {
              const depDevice = interconnect.getExportLocation()?.device;
              if (depDevice) {
                inputs.push(depDevice);
              }
            }
          }
          inputsMap.set(device, inputs);
        }

        // Then collect all active devices, those transitively connected to outputs.
        const activeDevices: DeviceLayout[] = [];
        utils.visitRec(
          sinkNode,
          node => inputsMap.get(node) ?? [],
          node => {
            activeDevices.push(node);
          });

        // Visit nodes, starting from top-left.
        const breakCyclesOrder = activeDevices.toSorted((a, b) => {
          const diffY = (a.lane?.y ?? 0) - (b.lane?.y ?? 0);
          const diffX = a.x - b.x;
          return diffY || diffX;
        });

        const consumedSet = new Set<DeviceLayout>();
        for (const device of breakCyclesOrder) {
          if (consumedSet.has(device)) {
            continue;
          }
          const deviceInputs = inputsMap.get(device) ?? [];
          const hadCycleInputs: DeviceLayout[] = [];
          for (const deviceInput of deviceInputs) {
            let hadCycle = false;
            utils.visitRec(
              [deviceInput],
              node => {
                const inputs = inputsMap.get(node) ?? [];
                if (inputs.includes(device)) {
                  hadCycle = true;
                }
                return hadCycle ? [] : inputs;
              },
              node => {});
            if (hadCycle) {
              hadCycleInputs.push(deviceInput);
            }
          }
          // Break cycles.
          for (const hadCycleInput of hadCycleInputs) {
            utils.arrayRemove(deviceInputs, hadCycleInput);
            console.log(`Broke cycle between`, hadCycleInput.decl.label, '=>', device.decl.label);
          }
        }

        // Traverse graph once again, with cycles broken.
        const executionOrder: DeviceLayout[] = [];
        utils.visitRec(
          activeDevices,
          node => inputsMap.get(node) ?? [],
          node => {
            executionOrder.push(node);
          });
        executionOrder.reverse();
        console.log(`Execution order: `, executionOrder.map(d => d.decl.label));

        const codeLines: string[] = [];
        const outputIndexAssignMap = MultiMap.basic<DeviceDecl, DeviceLayout>();
        const outputMap = new Map<DeviceLayout, { index: number }>();
        for (const device of executionOrder) {
          const index = outputIndexAssignMap.get(device.decl)?.size ?? 0;
          outputIndexAssignMap.add(device.decl, device);
          outputMap.set(device, { index: index });
        }
        for (const device of executionOrder) {
          const { index } = outputMap.get(device)!;
          const inputs = device.inPins.map(p => p.source.getExportLocation?.());
          const inputVarRefs = inputs.map(input => {
            if (!input) {
              return 'undefined';
            }
            const inputDeviceIndex = outputMap.get(input.device)?.index;
            if (inputDeviceIndex === undefined) {
              return 'undefined';
            }
            return sanitizeIdentifier(`${input.device.decl.label}${inputDeviceIndex}_${input.device.outPins.indexOf(canonical(input.outPin))}`);
          });
          const outputVarInits = device.outPins.map((p, i) => {
            const outputVar = sanitizeIdentifier(`${device.decl.label}${index}_${i}`);
            const outputField = stringifyIdentifier(p.decl.identifier);
            return `${outputField}: ${outputVar}`;
          });
          let varDecls = '';
          if (outputVarInits.length > 0) {
            varDecls = `const { ${outputVarInits.join(', ')} } = `;
          }
          codeLines.push(`${varDecls}${stringifyCodeRefGlobal(device.decl.codeRef)}(${inputVarRefs.join(', ')});`);
        }
        const fullCode = [
          `function run() {`,
          ...codeLines.map(line => `  ${line}`),
          `}`,
        ].join('\n');
        console.log(fullCode);
        this.compiler.setRunCode(fullCode);
      }
      this.deviceMap.sync(this.module.allDevices);
      this.requestUpdate();
    })();





    setTimeout(async () => {
      const bopLib = await import('../runtime/bop-javascript-lib');
      const webGpuContext = this.monitorEditorPanel.canvas.getContext("webgpu")!;
      bopLib.SharedMTLInternals().setTargetCanvasContext(webGpuContext);

      const moduleCode = await (await fetch('libcode/testcode/test.ts')).text();
      this.compiler.setModuleCode(moduleCode);
    });
  }

  startEdit(options?: ConstructorParameters<typeof EditOperation>[1]): EditOperation {
    const op = new EditOperation(this.module, options);
    op.onLanesEdited = (lanes) => {
      this.requestUpdate();
    };
    op.onDevicesEdited = (devices) => {
      for (const device of devices) {
        this.deviceMap.get(device)?.requestUpdate();
      }
    };
    op.onInterconnectsEdited = () => {
      this.requestUpdate();
    };
    op.onCommitted = () => {
      this.saveModuleState();
    };
    return op;
  }

  render() {
    const module = view(this.module);
    return html`
<div class="app mode-devices">
  <div class="lane-grid">
    ${module.lanes.map(this.renderLane.bind(this))}
    ${module.allInterconnects.map(this.renderInterconnect.bind(this))}
  </div>
  ${this.editorPanelsView}
</div>
`;
  }

  private renderLane(lane: LaneLayout) {
    if (isTrackLane(lane)) {
      return this.renderTrackLane(lane);
    } else if (isBusLane(lane)) {
      return this.renderBusLane(lane);
    }
  }
  private renderTrackLane(lane: TrackLaneLayout) {
    lane = view(lane);
    return html`
<div class="lane track" style=${styleMap({ '--y': lane.y, '--height': lane.height, '--track-height': lane.height - 1 })}>
  <div class="lane-device-track">
    ${lane.devices.map(device => this.deviceMap.get(device))}
  </div>
  <div class="lane-gutter">
  </div>
</div>
`;
  }
  private renderBusLane(lane: BusLaneLayout) {
    lane = view(lane);
    const renderImportPin = (pin: PinLayout) => {
      pin = view(pin);
      const source = view(pin.source);
      return html`
<div class="import-pin" style=${styleMap({ '--x': source.x, '--y': source.laneLocalY })}>
</div>
`;
    };

    lane = view(lane);
    return html`
<div class="lane bus" style=${styleMap({ '--y': lane.y, '--height': lane.height, '--track-height': lane.height })}>
  <div class="lane-bus-track">
    ${lane.importPins.map(renderImportPin)}
  </div>
</div>
`;
  }

  private renderInterconnect(interconnect: InterconnectLayout) {
    interconnect = view(interconnect);
    const path = interconnect.path;
    if (path.length === 0) {
      return;
    }

    const segmentContents = [];
    let prevPart = path[0];
    let [prevPosX, prevPosY] = getPathPointXY(prevPart);
    for (let i = 1; i < path.length; ++i) {
      const nextPart = path[i];
      const [nextPosX, nextPosY] = getPathPointXY(nextPart);

      let startX = prevPosX;
      let startY = prevPosY;
      let endX = nextPosX;
      let endY = nextPosY;
      if (startX > endX) {
        [endX, startX] = [startX, endX];
      }
      if (startY > endY) {
        [endY, startY] = [startY, endY];
      }
      if (Math.abs(startY - endY) < Math.abs(startX - endX)) {
        segmentContents.push(html`
          <div
              class="path-segment horizontal"
              style=${styleMap({
                '--y': startY.toFixed(2),
                '--start-x': startX.toFixed(2),
                '--end-x': endX.toFixed(2),
              })}>
          </div>
        `);
      } else {
        segmentContents.push(html`
          <div
              class="path-segment vertical"
              style=${styleMap({
                '--x': startX.toFixed(2),
                '--start-y': startY.toFixed(2),
                '--end-y': endY.toFixed(2),
              })}>
          </div>
        `);
      }

      prevPart = nextPart;
      prevPosX = nextPosX;
      prevPosY = nextPosY;
    }

    return html`
      <div
          class=${classMap({
            'interconnect': true,
            [interconnect.type]: true,
          })}
          style=${styleMap({
            '--wire-color':  cssColorFromHash(view(interconnect.start.source).sourceLabel),
          })}
          >
        ${segmentContents}
      </div>
    `;
  }
}

function sanitizeIdentifier(str: string): string {
  return str.replaceAll(/[^a-zA-Z0-9]/g, '_');
}

function stringifyCodeRefField(codeRef: CodeRef) {
  return codeRef.identifier;
}

function stringifyIdentifier(identifier: string) {
  return identifier;
}

function stringifyCodeRefGlobal(codeRef: CodeRef) {
  return codeRef.identifier;
}

function loadDeviceDecls(moduleExports: ModuleExports) {
  const makePrimitiveGroup = <T extends Record<string, boolean>>(
    init: {
      type: string;
    },
    types: T,
  ): Record<keyof T, TypeSpec> => {
    const entries = utils.objectMapEntries(types, ([k, v]) => {
      const newType: TypeSpec = {
        label: k,
        codeRef: { module: {}, identifier: k, },
        primitive: {
          type: init.type,
        },
        // isAssignableFrom: (other: TypeSpec) => {
        //   if (other === newType) {
        //     return TypeAssignable.SameType;
        //   }
        //   if (typeSet.has(other)) {
        //     return TypeAssignable.WithCoersion;
        //   }
        //   return TypeAssignable.NotAssignable;
        // }
      };
      return newType;
    });
    const typeSet = new Set(Object.values(entries));
    return entries;
  };

  const { float: floatType } = makePrimitiveGroup({ type: 'float' }, { 'float': true });
  const { float2: float2Type } = makePrimitiveGroup({ type: 'float2' }, { 'float2': true });
  const { float4: float4Type, color: colorType } = makePrimitiveGroup({ type: 'float4' }, {
    'float4': true,
    'color': true,
  });
  const { ['Texture']: textureType } = makePrimitiveGroup({ type: 'Texture' }, { ['Texture']: true });

  const basicTypes = {
    float: floatType,
    float2: float2Type,
    float4: float4Type,
    color: colorType,
    Texture: textureType,
  };

  const makeStructType = <T extends Record<string, TypeSpec>>(
    init: {
      label: string;
      identifier: string;
    },
    fields: T,
  ): TypeSpec => {
    const newType: TypeSpec = {
      label: init.label,
      codeRef: { module: {}, identifier: init.identifier, },
      struct: {
        fields: { ...fields }
      },
      // isAssignableFrom(other: TypeSpec) {
      //   return other === newType ? TypeAssignable.SameType : TypeAssignable.NotAssignable;
      // }
    };
    return newType;
  };

  const staticTypeMap = new Map<string, TypeSpec>();
  const typeFromStatic = (type: BapStaticType): TypeSpec => {
    if (type.isLibType) {
      return (basicTypes as Record<string, TypeSpec>)[type.identifier as string] ?? basicTypes.float;
    } else {
      const oldType = staticTypeMap.get(type.identifier);
      if (oldType) {
        return oldType;
      }
      const newType = makeStructType({ label: type.identifier, identifier: type.identifier }, Object.fromEntries(type.fields.map(t => [ t.identifier, typeFromStatic(t.type) ])));
      staticTypeMap.set(type.identifier, newType);
      return newType;
    }
  };

  const deviceDecls = new Map<string, DeviceDecl>();
  for (const exported of moduleExports.functions) {
    const inPins: PinDecl[] = [];
    for (const field of exported.parameters) {
      const inPin: PinDecl = {
        label: field.identifier,
        identifier: field.identifier,
        type: typeFromStatic(field.type),
      };
      inPins.push(inPin);
    }

    const outPins: PinDecl[] = [];
    if (exported.returnType && !exported.returnType.isLibType) {
      for (const field of exported.returnType.fields) {
        const outPin: PinDecl = {
          label: field.identifier,
          identifier: field.identifier,
          type: typeFromStatic(field.type),
        };
        outPins.push(outPin);
      }
    }

    const deviceDecl: DeviceDecl = {
      label: exported.identifier,
      codeRef: { module: {}, identifier: exported.identifier },
      inPins: inPins,
      // inPins: [putCodeRef({ label: 'in', type: textureType })],
      outPins: outPins,
    };
    console.log(deviceDecl);
    deviceDecls.set(exported.identifier, deviceDecl);
  }
  return { deviceDecls };
}

function makeTestData(moduleExports: ModuleExports): ModuleLayout {
  const { deviceDecls } = loadDeviceDecls(moduleExports);

  const textureInDecl = deviceDecls.get('textureIn')!;
  const findColorGradDecl = deviceDecls.get('findColorGrad')!;
  const unpackDecl = deviceDecls.get('unpack')!;
  const drawGradDecl = deviceDecls.get('drawGrad')!;
  const textureOutDecl = deviceDecls.get('textureOut')!;

  const module = new ModuleLayout();
  {
    using edit = new EditOperation(module);
    edit.write(() => {
      const lane1 = edit.insertLane();
      const lane3 = edit.insertBusLane();
      const lane2 = edit.insertLane();
      const textureIn = edit.insertDevice({ lane: lane1, x: 2, decl: textureInDecl });
      const findColorGrad = edit.insertDevice({ lane: lane1, x: 12, decl: findColorGradDecl });
      const drawGrad = edit.insertDevice({ lane: lane2, x: 10, decl: drawGradDecl });
      const unpack = edit.insertDevice({ lane: lane1, x: 20, decl: unpackDecl });
      const textureOut = edit.insertDevice({ lane: lane2, x: 28, decl: textureOutDecl });
      edit.setPinOptions({ pin: unpack.outPins[0], options: { connectToBus: {} } });
      edit.setPinOptions({ pin: unpack.outPins[1], options: { connectToBus: {} } });
      edit.setPinOptions({ pin: unpack.outPins[2], options: { connectToBus: {} } });
      edit.setPinOptions({ pin: unpack.outPins[3], options: { connectToBus: {} } });
    });
  }
  return module;
}
