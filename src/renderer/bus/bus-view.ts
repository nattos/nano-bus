import './device-editor-panel';
import './device-view';
import './editor-panels-view';
import './inspector-editor-panel-view';
import './monitor-editor-panel';
import './value-slider';

import { css, html, LitElement, PropertyValueMap } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { action, autorun, observable, makeObservable, runInAction } from 'mobx';
import * as utils from '../../utils';
import { CodeRef, DeviceDecl, DeviceLayout, PinDecl, TypeAssignable, TypeSpec } from './device-layout';
import { EditOperation } from './edit-operation';
import { ModuleLayout } from './module-layout';
import { isTrackLane, TrackLaneLayout } from './track-lane-layout';
import { InterconnectLayout, PathPoint } from './interconnect-layout';
import { canonical, view } from './utils';
import { APP_STYLES } from './app-styles';
import { cssColorFromHash, getPathPointXY } from './layout-utils';
import { MultiMap, ShadowMap, ShadowSet } from '../collections';
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
import { BusBapCompiler } from './bus-bap';
// import * as bap from '../bap';
// import * as bopLib from '../runtime/bop-javascript-lib';

interface CodeLine {
  code: string;
  debugInValues: number[];
  debugOutValues: number[];
}

@customElement('bus-view')
export class BusView extends MobxLitElement {
  static readonly styles = [APP_STYLES];
  static instance?: BusView;

  readonly compiler = new BusBapCompiler();
  private readonly moduleExportsTask = new utils.Resolvable<{ functions: BapStaticFunctionSignature[]; }>();

  readonly selectPaths = new SelectPaths();
  readonly monitorEditorPanel = new MonitorEditorPanel();
  readonly editorPanelsView = new EditorPanelsView({ selectPaths: this.selectPaths, });

  @observable codeLines: CodeLine[] = [];

  readonly module = new ModuleLayout();
  readonly deviceMap = new ShadowSet<DeviceLayout, DeviceView>({ shadowType: (d) => new DeviceView(this, d) });

  constructor() {
    super();
    BusView.instance = this;
    makeObservable(this);

    this.compiler.onStateChanged = (state, runnerState) => {
      if (state.module) {
        this.moduleExportsTask.resolve(state.module.exports);
      }
    };
  }

  connectedCallback(): void {
    super.connectedCallback();

    (async () => {
      const makePrimitiveGroup = <T extends Record<string, boolean>>(
        init: {
          type: string;
        },
        types: T,
      ): Record<keyof T, TypeSpec> => {
        const entries = utils.objectMapEntries(types, ([k, v]) => {
          const newType: TypeSpec = {
            label: k,
            primitive: {
              type: init.type,
            },
            isAssignableFrom: (other: TypeSpec) => {
              if (other === newType) {
                return TypeAssignable.SameType;
              }
              if (typeSet.has(other)) {
                return TypeAssignable.WithCoersion;
              }
              return TypeAssignable.NotAssignable;
            }
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
        },
        fields: T,
      ): TypeSpec => {
        const newType: TypeSpec = {
          label: init.label,
          struct: {
            fields: new Map(Object.entries(fields))
          },
          isAssignableFrom(other: TypeSpec) {
            return other === newType ? TypeAssignable.SameType : TypeAssignable.NotAssignable;
          }
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
          const newType = makeStructType({ label: type.identifier }, Object.fromEntries(type.fields.map(t => [ t.identifier, typeFromStatic(t.type) ])));
          staticTypeMap.set(type.identifier, newType);
          return newType;
        }
      };


      const moduleExports = await this.moduleExportsTask.promise;

      const deviceDecls = new Map<string, DeviceDecl>();
      for (const exported of moduleExports.functions) {
        const inPins: PinDecl[] = [];
        for (const field of exported.parameters) {
          const inPin: PinDecl = {
            label: field.identifier,
            codeRef: { module: {}, identifier: field.identifier },
            type: typeFromStatic(field.type),
          };
          inPins.push(inPin);
        }

        const outPins: PinDecl[] = [];
        if (exported.returnType && !exported.returnType.isLibType) {
          for (const field of exported.returnType.fields) {
            const outPin: PinDecl = {
              label: field.identifier,
              codeRef: { module: {}, identifier: field.identifier },
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



      // const findGradType = makeStructType(
      //   {
      //     label: 'FindGradData'
      //   },
      //   {
      //     primaryColor: colorType,
      //     primaryPoint: float2Type,
      //     secondaryColor: colorType,
      //     secondaryPoint: float2Type,
      //   },
      // );


      // function putCodeRef<T extends { label: string; }>(init: T): T&{ codeRef: CodeRef } {
      //   const toIdentifier = (label: string) => {
      //     const parts = label.split(' ');
      //     const camelParts = parts.map((part, i) => {
      //       if (i === 0 || !part) {
      //         return part;
      //       }
      //       return part[0].toUpperCase() + part.slice(1);
      //     });
      //     const camel = camelParts.join('');
      //     return sanitizeIdentifier(camel);
      //   };
      //   const codeRef: CodeRef = { module: {}, identifier: toIdentifier(init.label) };
      //   return { codeRef: codeRef, ...init };
      // }

      // const textureInDecl: DeviceDecl = putCodeRef({
      //   label: 'texture in',
      //   inPins: [],
      //   // inPins: [putCodeRef({ label: 'in', type: textureType })],
      //   outPins: [putCodeRef({ label: 'out', type: textureType })],
      // });
      // const textureOutDecl: DeviceDecl = putCodeRef({
      //   label: 'texture out',
      //   inPins: [putCodeRef({ label: 'out', type: textureType })],
      //   outPins: [],
      // });
      // const findColorGradDecl: DeviceDecl = putCodeRef({
      //   label: 'find color grad',
      //   inPins: [
      //     putCodeRef({ label: 'tex', type: textureType }),
      //   ],
      //   outPins: [putCodeRef({ label: 'out', type: findGradType })],
      // });
      // const drawGradDecl: DeviceDecl = putCodeRef({
      //   label: 'draw grad',
      //   inPins: [
      //     putCodeRef({ label: 'primary color', type: colorType }),
      //     putCodeRef({ label: 'primary point', type: float2Type }),
      //     putCodeRef({ label: 'secondary color', type: colorType }),
      //     putCodeRef({ label: 'secondary point', type: float2Type }),
      //   ],
      //   outPins: [putCodeRef({ label: 'out', type: textureType })],
      // });

      // const unpackDecl: DeviceDecl = putCodeRef({
      //   label: 'unpack',
      //   inPins: [
      //     putCodeRef({ label: 'tex', type: findGradType }),
      //   ],
      //   outPins: [
      //     putCodeRef({ label: 'primary color', type: colorType }),
      //     putCodeRef({ label: 'primary point', type: float2Type }),
      //     putCodeRef({ label: 'secondary color', type: colorType }),
      //     putCodeRef({ label: 'secondary point', type: float2Type }),
      //   ],
      // });
      const textureInDecl = deviceDecls.get('textureIn')!;
      const findColorGradDecl = deviceDecls.get('findColorGrad')!;
      const unpackDecl = deviceDecls.get('unpack')!;
      const drawGradDecl = deviceDecls.get('drawGrad')!;
      const textureOutDecl = deviceDecls.get('textureOut')!;

      let editDevice: DeviceLayout;
      {
        using edit = new EditOperation(this.module, { isContinuous: true });
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

          // edit.setPinOptions({ pin: textureIn.inPins[0], options: { connectToBus: {} } });
          // edit.setPinOptions({ pin: drawGrad.outPins[0], options: { connectToBus: {} } });
          // edit.setPinOptions({ pin: textureOut.inPins[0], options: { connectToBus: {} } });

          editDevice = drawGrad;
        });
      }

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
        const sinkNode = this.module.allDevices[4];

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
          [sinkNode],
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
            const outputField = stringifyCodeRefField(p.decl.codeRef);
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

      // this.editorPanelsView.pushEditorPanel(new DeviceEditorPanel({ device: editDevice! }));
      // this.editorPanelsView.pushEditorPanel(new InspectorEditorPanel({ value: editDevice!.outPins[0].source.editableValue }));
      // this.editorPanelsView.pushEditorPanel(new InspectorEditorPanel({ value: editDevice!.inPins[0].source.editableValue }));

      // const floatDecl: DeviceDecl = {
      //   label: 'float',
      //   inPins: [],
      //   outPins: [{ label: 'out', type: floatType }],
      // };
      // const addDecl: DeviceDecl = {
      //   label: 'add',
      //   inPins: [{ label: 'a', type: floatType }, { label: 'b', type: floatType }],
      //   outPins: [{ label: 'out', type: floatType }],
      // };

      // {
      //   using edit = new EditOperation(this.module, { isContinuous: true });
      //   edit.write(() => {
      //     const lane1 = edit.insertLane();
      //     const lane2 = edit.insertLane();
      //     const device1 = edit.insertDevice({ lane: lane1, x: 2, decl: addDecl });
      //     const device2 = edit.insertDevice({ lane: lane1, x: 15, decl: addDecl });
      //     const device3 = edit.insertDevice({ lane: lane2, x: 12, decl: addDecl });
      //     const floatLiteralA = edit.insertDevice({ lane: lane2, x: 0, decl: floatDecl });
      //     // edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device2.inPins[0] });
      //     // edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device2.inPins[1] });
      //     // edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device3.inPins[0] });
      //     edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device3.inPins[1] });
      //   });
      // }
      this.deviceMap.sync(this.module.allDevices);
      this.requestUpdate();
    })();





    setTimeout(async () => {
      const bopLib = await import('../runtime/bop-javascript-lib');
      const webGpuContext = this.monitorEditorPanel.canvas.getContext("webgpu")!;
      bopLib.SharedMTLInternals().setTargetCanvasContext(webGpuContext);

      const moduleCode = await (await fetch('libcode/testcode/test.ts')).text();
      this.compiler.setModuleCode(moduleCode);

      // const fullCode = await (await fetch('libcode/testcode/test.ts')).text() + '\n' + runCode;

      // const fullCode = initialCode;
      // const bap = await import('../bap');
      // const withoutRunCode = await (await fetch('libcode/testcode/test.ts')).text();
      // const precompileResult = await bap.compile(withoutRunCode);
      // moduleExportsTask.resolve(precompileResult.exports);

      // const runCode = await runCodeTask.promise;
      // const withRunCode = withoutRunCode + '\n' + runCode;
      // const codeLines = withRunCode.split('\n');
      // const compileResult = await bap.compile(withRunCode);
      // await compileResult.frameRunner.runOneFrame();
      // console.log('done compileResult.frameRunner.runOneFrame()');
      // // await compileResult.frameRunner.runOneFrame();
      // // console.log('done compileResult.frameRunner.runOneFrame()');
      // // await compileResult.frameRunner.runOneFrame();
      // // console.log('done compileResult.frameRunner.runOneFrame()');
      // // await compileResult.frameRunner.runOneFrame();
      // // console.log('done compileResult.frameRunner.runOneFrame()');
      // runInAction(() => {
      //   this.codeLines.splice(0);
      //   this.codeLines.push(...codeLines.map((codeLine) => ({
      //     code: codeLine,
      //     debugInValues: [],
      //     debugOutValues: [0],
      //   })));
      // });
    });
  }

  startEdit(options: ConstructorParameters<typeof EditOperation>[1]): EditOperation {
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
//       return html`
// <div class="lane" style=${styleMap({ '--y': lane.y, '--height': lane.height })}>
//   <div class="lane-device-track">
//     ${lane.devices.map(this.renderDevice.bind(this))}
//   </div>
//   <div class="lane-gutter">
//   </div>
// </div>
// `;
  }
}

function sanitizeIdentifier(str: string): string {
  return str.replaceAll(/[^a-zA-Z0-9]/g, '_');
}

function stringifyCodeRefField(codeRef: CodeRef) {
  return codeRef.identifier;
}

function stringifyCodeRefGlobal(codeRef: CodeRef) {
  return codeRef.identifier;
}
