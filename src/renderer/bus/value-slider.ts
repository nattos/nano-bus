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
import { DeviceEditorPanel } from './device-editor-panel';
import { FloatInspector } from './inspectors/float';
import { StructInspector } from './inspectors/struct';
import { EditableValue } from './editable-value';
import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';

@customElement('bus-value-slider')
export class ValueSlider extends MobxLitElement {
  static readonly styles = [
    APP_STYLES,
    css`
`,
  ];

  @property({ attribute: false }) editable?: EditableValue = undefined;

  private dragOp?: PointerDragOp;

  render() {
    const value = this.editable?.getObservableValue(Number);
    const options = this.editable?.getObservableOptions();

    const doStartDrag = (e: PointerEvent) => {
      const startValue = value ?? 0.0;
      this.dragOp = new PointerDragOp(e, this, {
        move: (e, delta) => {
          const clientWidth = this.getBoundingClientRect().width;
          const newValue = startValue - delta[0] / clientWidth;
          this.editable?.setObservableValue(Number, newValue);
        },
        accept: (e, delta) => {
        },
        cancel: () => {
        },
      });
    };

    return html`
<div
    class="field float"
    @pointerdown=${(e: PointerEvent) => doStartDrag(e)}
    >
  <div class="field-bar" style=${styleMap({ '--value': value?.toFixed(2) })}></div>
  <div class="field-label">${this.editable?.label}</div>
  <div class="field-value">${value?.toFixed(2)}</div>
</div>
`;
  }
}
