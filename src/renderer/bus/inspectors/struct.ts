import { html, HTMLTemplateResult } from "lit";
import { EditableValue } from "../editable-value";
import { Inspector } from "../inspector";
import { observable } from "mobx";

export class StructInspector implements Inspector {
  @observable value: EditableValue | undefined;

  render(): HTMLTemplateResult | undefined {
    const fields = this.value?.getChildren();
    const fieldsContent = [];

    if (fields) {
      for (const field of fields) {
        fieldsContent.push(html`
<bus-value-slider .editable=${field}></bus-value-slider>
`);
      }
    }

    return html`
<div class="landmark-header">
  <div>1</div>
  <div>2</div>
  <div>3</div>
  <div>4</div>
</div>
<div class="field-block">
  ${fieldsContent}
</div>
`;
  }
}
