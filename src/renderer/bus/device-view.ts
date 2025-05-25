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
import { cssColorFromHash, Point } from './layout-utils';
import { PointerDragOp } from '../components/pointer-drag-op';
import { BusView } from './bus-view';

@customElement('bus-device')
export class DeviceView extends LitElement {
  static readonly styles = [APP_STYLES];

  private dragOp?: PointerDragOp;

  constructor(readonly parent: BusView, readonly device: DeviceLayout) {
    super();
  }

  [Symbol.dispose]() {
    this.remove();
  }

  render() {
    const device = view(this.device);
    const label = device.decl.label;
    const labelLines = label.split(' ');
    const maxLineLength = Math.max(...labelLines.map(line => line.length));

    const doDragStart = (e: PointerEvent) => {
      const edit = this.parent.startEdit({ label: 'drag', isContinuous: true });
      const startX = this.device.x;
      const startY = view(this.device.lane)?.index ?? 0;
      this.dragOp = new PointerDragOp(e, this, {
        move: (e: PointerEvent, delta: Point) => {
          edit.write(() => {
            const newX = startX - delta[0] / 20;
            const newY = Math.round(startY - delta[1] / (20 * 5)) | 0;
            const lanes = view(device.module).lanes;
            const newLane = lanes.at(Math.max(0, Math.min(lanes.length - 1, newY))) ?? view(this.device.lane);
            edit.moveDevice({ device: this.device, x: newX, lane: newLane });
          });
        },
        accept: () => {
          edit[Symbol.dispose]();
        },
        cancel: () => {
          edit.cancel();
        },
      });
    };

    return html`
<div
  class="device"
  style=${styleMap({
    '--x': device.x,
    '--width': device.width,
    '--card-bgcolor': cssColorFromHash(device.decl.label),
  })}
  @pointerdown=${doDragStart}
  >
  <div class="label" style=${styleMap({ '--x-count': maxLineLength, '--y-count': labelLines.length })}>
    ${labelLines.map(line => html`
    <div>
      ${line}
    </div>
    `)}
  </div>
  <div class="in-pins">
    ${device.inPins.map(p => html`
    <div class="pin">
      <div class="pin-field">
        <div class="pin-field-label">${p.decl.label}</div>
        <div class="pin-field-value">1.125</div>
      </div>
    </div>
    `)}
  </div>
  <div class="out-pins">
    ${device.outPins.map(p => html`
    <div class="pin">
      <div class="pin-field">
        <div class="pin-field-label">${p.decl.label}</div>
        <div class="pin-field-value">1.125</div>
      </div>
    </div>
    `)}
  </div>
</div>
`;
  }
}
