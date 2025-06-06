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
import { StructInspector } from './inspectors/struct';
import { EditableValue } from './editable-value';
import { Inspector } from './inspector';
import { FloatInspector } from './inspectors/float';
import { SelectPaths } from './select-paths.ts';
import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';

@customElement('bus-inspector-editor-panel')
export class InspectorEditorPanel extends MobxLitElement {
  static readonly styles = [
    APP_STYLES,
    css`
.editor-panel {
  height: -webkit-fill-available;
}
`,
  ];

  @property({ attribute: false }) editPath?: string[];
  @property({ attribute: false }) value?: EditableValue;
  @property({ attribute: false }) selectPaths?: SelectPaths;

  private inspector?: Inspector;

  constructor(init?: { value?: EditableValue; }) {
    super();
    this.value = init?.value;
  }

  render() {
    if (!this.inspector || this.inspector?.value !== this.value) {
      if (this.value?.valueType.typeSpec.primitive) {
        this.inspector = new FloatInspector();
      } else {
        this.inspector = new StructInspector();
      }
      this.inspector.value = this.value;
    }

    return html`
<div class="editor-panel">
  <div class="panel-standard-container">
    <div class="chip-block pins">
      <div class="landmark-header">
        <div class="landmark-label">${this.value?.label}</div>
        <div class="landmark-type typespec">${this.value?.valueType.typeSpec.label}</div>
      </div>
      <div class="chip editor-type">struct</div>
    </div>
    ${this.inspector?.render()}
  </div>
</div>
`;
  }
}
