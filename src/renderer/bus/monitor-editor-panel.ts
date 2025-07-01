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
import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';

@customElement('bus-monitor-editor-panel')
export class MonitorEditorPanel extends MobxLitElement {
  static readonly styles = [
    APP_STYLES,
    css`
.editor-panel {
  height: -webkit-fill-available;
}
`,
  ];

  readonly canvas = document.createElement('canvas');

  constructor() {
    super();
    this.canvas.id = 'gpu-canvas';
  }

  render() {
    return html`
${this.canvas}
<div>1920x1080 rgba 8bpp unorm</div>
`;
  }
}
