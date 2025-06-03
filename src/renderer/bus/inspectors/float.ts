import { html, HTMLTemplateResult } from "lit";
import { EditableValue } from "../editable-value";
import { Inspector } from "../inspector";
import { observable } from "mobx";

export class FloatInspector implements Inspector {
  @observable value: EditableValue | undefined;

  render(): HTMLTemplateResult | undefined {
    return html`
<div class="spark-chart">
  spark chart
</div>
<bus-value-slider .editable=${this.value}></bus-value-slider>
`;
  }
}
