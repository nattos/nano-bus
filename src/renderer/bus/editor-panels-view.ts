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
import { InspectorEditorPanel } from './inspector-editor-panel-view';
import { SelectPaths } from './select-paths.ts';
import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';

@customElement('bus-editor-panels')
export class EditorPanelsView extends MobxLitElement {
  static readonly styles = [
    APP_STYLES,
    css`
`,
  ];

  @property({ attribute: false }) selectPaths?: SelectPaths;

  private stickyPanels: HTMLElement[] = observable([]);
  private panelStack: HTMLElement[] = observable([]);

  constructor(init?: { selectPaths?: SelectPaths; }) {
    super();
    this.selectPaths = init?.selectPaths;
  }

  @action
  pushEditorPanel(panel: HTMLElement, options?: { sticky?: boolean; }) {
    if (options?.sticky) {
      this.stickyPanels.push(panel);
    } else {
      this.panelStack.push(panel);
    }
  }

  @action
  popEditorPanel(panel?: HTMLElement) {
    utils.arrayRemove(this.panelStack, panel);
  }

  render() {
    return html`
<div class="editor-panels">
  <div class="editor-panels-bookend"></div>
  ${this.stickyPanels}
  ${this.panelStack}
  ${this.selectPaths?.renderEditorPanels()}
  <div class="editor-panels-bookend"></div>
</div>
`;
  }
}
