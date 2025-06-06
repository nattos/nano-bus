import { TypeLayout } from "./device-layout";

export enum MultiValueState {
  SingleValue = 'SingleValue',
  IncomparableValues = 'IncomparableValues',
  EqualValues = 'EqualValues',
  ManyValues = 'ManyValues',
}

export type IntrinsicValueType = typeof Number | typeof Boolean;
export type IntrinsicValueValue<T extends IntrinsicValueType> =
    T extends typeof Number ? number :
    T extends typeof Boolean ? boolean :
    never;

export interface EditableValueOptions {
  minValue?: number;
  maxValue?: number;
}

export interface EditableValue {
  label: string;
  valueType: TypeLayout;
  getChildren(): EditableValue[]|undefined;
  getObservableValue<T extends typeof Number>(type: T): IntrinsicValueValue<T>|undefined;
  setObservableValue<T extends typeof Number>(type: T, value: IntrinsicValueValue<T>): void;
  resetObservableValue(): void;
  getObservableOptions(): EditableValueOptions;
  multiValueState: MultiValueState;
}
