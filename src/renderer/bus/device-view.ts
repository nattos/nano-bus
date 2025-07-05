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
import { cssColorFromHash, Point } from './layout-utils';
import { CancelReason, PointerDragOp } from '../components/pointer-drag-op';
import { BusView } from './bus-view';
import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';

@customElement('bus-device')
export class DeviceView extends MobxLitElement {
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

            let newLane: TrackLaneLayout|undefined;
            const laneSearchStart = Math.max(0, Math.min(lanes.length - 1, newY));
            for (let searchY = laneSearchStart; searchY < lanes.length; ++searchY) {
              const searchLane = lanes[searchY];
              if (isTrackLane(searchLane)) {
                newLane = searchLane;
                break;
              }
            }
            newLane ??= this.device.lane;

            edit.moveDevice({ device: this.device, x: newX, lane: newLane });
          });
        },
        accept: () => {
          edit[Symbol.dispose]();
        },
        cancel: (reason) => {
          edit.cancel();

          if (reason === CancelReason.NoChange) {
            // This was a click!
            this.parent.selectPaths.selectPath(this.device.uniqueKey);
          }
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
      <div class="field">
        <div class="field-label">${p.decl.label}</div>
        <div class="field-value">${p.source.editableValue?.getObservableValue(Number)}</div>
      </div>
    </div>
    `)}
  </div>
  <div class="out-pins">
    ${device.outPins.map(p => html`
    <div class="pin">
      <div class="pin-field  field">
        <div class="field-label">${p.decl.label}</div>
        <div class="field-value">${p.source.editableValue?.getObservableValue(Number)}</div>
      </div>
    </div>
    `)}
  </div>
</div>
`;
  }
}
