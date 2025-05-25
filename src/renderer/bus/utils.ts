import { EditOperation } from "./edit-operation";

export function orRef<T>(editValue: T|undefined|null, realValue: T|undefined): T|undefined {
  if (editValue === null) {
    return undefined;
  }
  return editValue ?? realValue;
}

export interface Newable<T> {
  new(shadowOf: T): T;
}

export interface Editable<T> {
  shadowOf?: T;
  continuousEdit?: T;
  editType: Newable<T>;
}

export function view<T extends Editable<T>>(v: T): T;
export function view<T extends Editable<T>>(v: T|undefined): T|undefined;
export function view<T extends Editable<T>>(v: T|undefined): T|undefined {
  return v?.continuousEdit ?? v;
}

export function edit<T extends Editable<T>>(v: T): T {
  if (!EditOperation.continuousEdit) {
    return v;
  }
  return EditOperation.continuousEdit.ensureEditable(v);
}

export function canonical<T extends Editable<T>>(v: T): T;
export function canonical<T extends Editable<T>>(v: T|undefined): T|undefined;
export function canonical<T extends Editable<T>>(v: T|undefined): T|undefined {
  return v?.shadowOf ?? v;
}
