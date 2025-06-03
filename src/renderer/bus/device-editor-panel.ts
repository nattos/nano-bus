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
import { PointerDragOp } from '../components/pointer-drag-op';
import { BusView } from './bus-view';
import { PinLayout } from './pin-layout';
import { SelectPaths } from './select-paths.ts';

@customElement('bus-device-editor-panel')
export class DeviceEditorPanel extends LitElement {
  static readonly styles = [
    APP_STYLES,
    css`
.editor-panel {
  height: -webkit-fill-available;
}
`,
  ];

  @property({ attribute: false }) editPath?: string[];
  @property({ attribute: false }) device?: DeviceLayout;
  @property({ attribute: false }) selectPaths?: SelectPaths;

  constructor(init?: { device?: DeviceLayout }) {
    super();
    this.device = init?.device;
  }

  render() {
    const renderPin = (pin: PinLayout, index: number, location: 'in'|'out') => {
      const doSelect = () => {
        if (!this.editPath || !this.selectPaths) {
          return;
        }
        const childPath = this.editPath.concat([ `${location}Pin${index}` ]);
        this.selectPaths.selectPath(childPath);
      };
      return html`
<div
    class="chip"
    @click=${doSelect}
    >
  ${pin.decl.label}
</div>
      `;
    };

    return html`
<div class="editor-panel">
  <div class="panel-standard-container">
    <div class="landmark-header">
      <div class="landmark-label">${this.device?.decl.label}</div>
      <div class="landmark-type device">${this.device?.decl.label}</div>
    </div>
    <div>
      overloads <div class="chip">1 / 5</div>
    </div>
    <div class="chip-block pins">
      <div class="header">inputs</div>
      ${this.device?.inPins.map((p, i) => renderPin(p, i, 'in'))}
    </div>
    <div class="chip-block pins">
      <div class="header">outputs</div>
      ${this.device?.outPins.map((p, i) => renderPin(p, i, 'out'))}
    </div>
  </div>
</div>
`;
  }
}
