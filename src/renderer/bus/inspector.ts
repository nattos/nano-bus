import { HTMLTemplateResult } from "lit";
import { EditableValue } from "./editable-value";

export interface Inspector {
  value: EditableValue|undefined;
  render(): HTMLTemplateResult|undefined;
}
