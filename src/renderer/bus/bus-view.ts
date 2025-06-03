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
import { DeviceDecl, DeviceLayout, TypeAssignable, TypeSpec } from './device-layout';
import { EditOperation } from './edit-operation';
import { ModuleLayout } from './module-layout';
import { isTrackLane, TrackLaneLayout } from './track-lane-layout';
import { InterconnectLayout, PathPoint } from './interconnect-layout';
import { view } from './utils';
import { APP_STYLES } from './app-styles';
import { cssColorFromHash, getPathPointXY } from './layout-utils';
import { ShadowMap, ShadowSet } from '../collections';
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
// import * as bap from '../bap';
// import { SharedMTLInternals } from '../runtime/bop-javascript-lib';

interface CodeLine {
  code: string;
  debugInValues: number[];
  debugOutValues: number[];
}

@customElement('bus-view')
export class BusView extends LitElement {
  static readonly styles = [APP_STYLES];
  static instance?: BusView;

  @query('#gpu-canvas') gpuCanvas!: HTMLCanvasElement;
  readonly selectPaths = new SelectPaths();
  readonly editorPanelsView = new EditorPanelsView({ selectPaths: this.selectPaths, });

  @observable codeLines: CodeLine[] = [];

  readonly module = new ModuleLayout();
  readonly deviceMap = new ShadowSet<DeviceLayout, DeviceView>({ shadowType: (d) => new DeviceView(this, d) });

  constructor() {
    super();
    BusView.instance = this;
    makeObservable(this);
  }

  connectedCallback(): void {
    super.connectedCallback();

    const floatType: TypeSpec = {
      label: 'float',
      isAssignableFrom(other: TypeSpec) { return other === this ? TypeAssignable.SameType : TypeAssignable.NotAssignable; }
    };
    const float2Type: TypeSpec = {
      label: 'float2',
      isAssignableFrom(other: TypeSpec) { return other === this ? TypeAssignable.SameType : TypeAssignable.NotAssignable; }
    };
    const float4Type: TypeSpec = {
      label: 'float4',
      isAssignableFrom(other: TypeSpec) { return other === this ? TypeAssignable.SameType : other === colorType ? TypeAssignable.WithCoersion : TypeAssignable.NotAssignable; }
    };
    const colorType: TypeSpec = {
      label: 'color',
      isAssignableFrom(other: TypeSpec) { return other === this ? TypeAssignable.SameType : other === float4Type ? TypeAssignable.WithCoersion : TypeAssignable.NotAssignable; }
    };
    const textureType: TypeSpec = {
      label: 'Texture',
      isAssignableFrom(other: TypeSpec) { return other === this ? TypeAssignable.SameType : TypeAssignable.NotAssignable; }
    };

    const textureInDecl: DeviceDecl = {
      label: 'texture in',
      inPins: [],
      outPins: [{ label: 'out', type: textureType }],
    };
    const textureOutDecl: DeviceDecl = {
      label: 'texture out',
      inPins: [{ label: 'out', type: textureType }],
      outPins: [],
    };
    const findGradType: TypeSpec = {
      label: 'FindGradData',
      isAssignableFrom(other: TypeSpec) { return other === this ? TypeAssignable.SameType : TypeAssignable.NotAssignable; }
    };
    const findColorGradDecl: DeviceDecl = {
      label: 'find color grad',
      inPins: [
        { label: 'tex', type: textureType },
      ],
      outPins: [{ label: 'out', type: findGradType }],
    };
    const drawGradDecl: DeviceDecl = {
      label: 'draw grad',
      inPins: [
        { label: 'primary color', type: colorType },
        { label: 'primary point', type: float2Type },
        { label: 'secondary color', type: colorType },
        { label: 'secondary point', type: float2Type },
      ],
      outPins: [{ label: 'out', type: textureType }],
    };

    const unpackDecl: DeviceDecl = {
      label: 'unpack',
      inPins: [
        { label: 'tex', type: findGradType },
      ],
      outPins: [
        { label: 'primary color', type: colorType },
        { label: 'primary point', type: float2Type },
        { label: 'secondary color', type: colorType },
        { label: 'secondary point', type: float2Type },
      ],
    };
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

        editDevice = drawGrad;
      });
    }

    this.editorPanelsView.pushEditorPanel(new MonitorEditorPanel(), { sticky: true });

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
    this.selectPaths.selectPath([ this.module.allDevices[2].uniqueKey ]);

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
    this.editorPanelsView.requestUpdate();
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
