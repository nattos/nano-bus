import { html, HTMLTemplateResult } from "lit";
import { EditableValue } from "../editable-value";
import { Inspector } from "../inspector";
import { observable } from "mobx";

export class StructInspector implements Inspector {
  @observable value: EditableValue | undefined;

  render(): HTMLTemplateResult | undefined {
    return html`
<div class="landmark-header">
  <div>1</div>
  <div>2</div>
  <div>3</div>
  <div>4</div>
</div>
<div class="field-block">
  <div class="field texture">
    <div class="field-label">texture</div>
    <div class="field-value">0.135</div>
  </div>
  <div class="field float">
    <div class="field-label">quality</div>
    <div class="field-value">0.135</div>
  </div>
  <div class="field float">
    <div class="field-label">guassian</div>
    <div class="field-value">0.135</div>
  </div>
  <div class="field float">
    <div class="field-label">a</div>
    <div class="field-value">0.135</div>
  </div>
  <div class="field float">
    <div class="field-label">b</div>
    <div class="field-value">0.135</div>
  </div>
  <div class="field float">
    <div class="field-label">c</div>
    <div class="field-value">0.135</div>
  </div>
  <div class="field float">
    <div class="field-label">d</div>
    <div class="field-value">0.135</div>
  </div>
  <div class="field float">
    <div class="field-label">d</div>
    <div class="field-value">0.135</div>
  </div>
</div>
`;
  }
}
