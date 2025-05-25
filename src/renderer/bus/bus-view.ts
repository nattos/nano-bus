import { css, html, LitElement, PropertyValueMap } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { action, autorun, observable, makeObservable, runInAction } from 'mobx';
import * as utils from '../../utils';
import { DeviceDecl, DeviceLayout, TypeAssignable, TypeSpec } from './device-layout';
import { EditOperation } from './edit-operation';
import { ModuleLayout } from './module-layout';
import { TrackLaneLayout } from './track-lane-layout';
import { InterconnectLayout, PathPoint } from './interconnect-layout';
import { view } from './utils';
import { APP_STYLES } from './app-styles';
import { cssColorFromHash, getPathPointXY } from './layout-utils';
import { ShadowMap, ShadowSet } from '../collections';
import { DeviceView } from './device-view';
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

    const floatDecl: DeviceDecl = {
      label: 'float',
      inPins: [],
      outPins: [{ label: 'out', type: floatType }],
    };
    const addDecl: DeviceDecl = {
      label: 'add',
      inPins: [{ label: 'a', type: floatType }, { label: 'b', type: floatType }],
      outPins: [{ label: 'out', type: floatType }],
    };

    {
      using edit = new EditOperation(this.module, { isContinuous: true });
      edit.write(() => {
        const lane1 = edit.insertLane();
        const lane2 = edit.insertLane();
        const device1 = edit.insertDevice({ lane: lane1, x: 2, decl: addDecl });
        const device2 = edit.insertDevice({ lane: lane1, x: 15, decl: addDecl });
        const device3 = edit.insertDevice({ lane: lane2, x: 12, decl: addDecl });
        const floatLiteralA = edit.insertDevice({ lane: lane2, x: 0, decl: floatDecl });
        // edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device2.inPins[0] });
        // edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device2.inPins[1] });
        // edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device3.inPins[0] });
        edit.connectPins({ fromOutPin: floatLiteralA.outPins[0], toInPin: device3.inPins[1] });
      });
    }
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
    return html`
<div class="app mode-devices">
  <div>
    <canvas id="gpu-canvas"></canvas>
  </div>
  <div class="lane-grid">
    ${module.lanes.map(this.renderLane.bind(this))}
    ${module.allInterconnects.map(this.renderInterconnect.bind(this))}
  </div>
  <div style="background-color: pink;">hello world</div>
</div>
`;
  }

  private renderLane(lane: TrackLaneLayout) {
    lane = view(lane);
    return html`
<div class="lane" style=${styleMap({ '--y': lane.y, '--height': lane.height })}>
  <div class="lane-device-track">
    ${lane.devices.map(device => this.deviceMap.get(device))}
  </div>
  <div class="lane-gutter">
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
            '--wire-color':  cssColorFromHash(view(interconnect.start.device).decl.label),
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
