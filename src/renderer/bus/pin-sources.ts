import { action, observable, runInAction } from "mobx";
import { BusLaneLayout } from "./bus-lane-layout";
import { DeviceLayout, TypeSpec } from "./device-layout";
import { EditableValue, EditableValueOptions, IntrinsicValueType, IntrinsicValueValue, MultiValueState } from "./editable-value";
import { PinSource, PinLocation, ExportLocation, PinLayout } from "./pin-layout";
import { view, canonical } from "./utils";
import { toCodeRefMapKey } from "./code-refs";
import { NewDecls } from "./module-layout";

export class DevicePinSource implements PinSource {
  constructor(readonly device: DeviceLayout, readonly location: PinLocation, public pinIndex: number) {}

  pin?: PinLayout;
  storageEditableValue?: StorageEditableValue;

  get x() {
    return this.location === PinLocation.In ? view(this.device).x : view(this.device).maxX;
  }
  get laneLocalY() {
    return this.pinIndex;
  }
  get lane() {
    return view(this.device).lane;
  }
  get label() {
    return this.pin?.decl.label ?? 'unknown';
  }
  get sourceLabel() {
    return view(this.device).decl.label;
  }
  get editableValue() {
    return this.storageEditableValue;
  }
  markDirty() {
    // this.editedDevices.add(canonical(device));
    // this.autoInterconnectsDirty = true;
  }
  getExportLocation(): ExportLocation|undefined {
    if (!this.pin) {
      return;
    }
    if (this.location === PinLocation.Out) {
      return { device: this.device, outPin: this.pin };
    }
    const interconnect = this.pin.interconnects?.at(0);
    return interconnect?.getExportLocation();
  }

  applyDecls(newDecls: NewDecls) {
    this.storageEditableValue?.applyDecls(newDecls);
  }

  static toJson() {}
  static fromJson(instance: DevicePinSource, host: {}) {
    console.log('DevicePinSource', 'fromJson', instance);
  }
}


export class BusLaneEphemeralPinSource implements PinSource {
  constructor(readonly inLane: BusLaneLayout, readonly deviceOutPin: PinLayout) {}

  get x() {
    return view(this.deviceOutPin.source).x + 1;
  }
  get laneLocalY() {
    return 0;
  }
  get lane() {
    return this.inLane;
  }
  get label() {
    return view(this.deviceOutPin.source).label;
  }
  get sourceLabel() {
    return view(this.deviceOutPin.source).sourceLabel;
  }
  get editableValue() {
    return this.deviceOutPin.source.editableValue;
  }
  markDirty() {}
  getExportLocation() {
    return this.deviceOutPin.source.getExportLocation?.();
  }

  applyDecls(newDecls: NewDecls) {}

  static toJson() {}
  static fromJson(instance: BusLaneEphemeralPinSource, host: {}) {
    console.log('BusLaneEphemeralPinSource', 'fromJson', instance);
  }
}











type StorageEditableValueNode = StorageEditableValueStructNode | StorageEditableValueFieldNode;

export class StorageEditableValue implements EditableValue {
  constructor(
    readonly label: string,
    public valueType: TypeSpec,
    public rootState: Record<string, any>,
    public rootValue: StorageEditableValueNode,
  ) {}

  getChildren() { return this.rootValue.getChildren(); }
  getObservableValue<T extends typeof Number>(type: T) { return this.rootValue.getObservableValue<T>(type); }
  setObservableValue<T extends typeof Number>(type: T, value: IntrinsicValueValue<T>) { return this.rootValue.setObservableValue<T>(type, value); }
  resetObservableValue() { this.rootValue.resetObservableValue(); }
  getObservableOptions() { return this.rootValue.getObservableOptions(); }
  get multiValueState() { return this.rootValue.multiValueState; }

  applyDecls(newDecls: NewDecls) {
    const state = this.rootState;
    const children: StorageEditableValueNode[] = [];
    addFieldRec(state, children, this.label, this.valueType, { newTypeMap: newDecls.typeDeclsMap });
    const rootValue = children[0];
    this.valueType = rootValue.valueType;
    this.rootValue = rootValue;
  }

  static toJson(instance: StorageEditableValue) {
    delete (instance as any)['rootValue'];
    return instance;
  }
  static fromJson(instance: StorageEditableValue, host: {}) {
    console.log('StorageEditableValue', 'fromJson', instance);

    const state = observable(instance.rootState);
    const children: StorageEditableValueNode[] = [];
    addFieldRec(state, children, instance.label, instance.valueType);
    const rootValue = children[0];
    instance.valueType = rootValue.valueType;
    instance.rootState = state;
    instance.rootValue = rootValue;
  }
  static fromType(label: string, type: TypeSpec, host: {}): StorageEditableValue {
    const state = observable({});
    const children: StorageEditableValueNode[] = [];
    addFieldRec(state, children, label, type);
    const rootValue = children[0];
    return new StorageEditableValue(label, rootValue.valueType, state, rootValue);
  }
}

class StorageEditableValueStructNode implements EditableValue {
  readonly multiValueState = MultiValueState.SingleValue;

  constructor(
    readonly label: string,
    readonly valueType: TypeSpec,
    readonly childEditables: StorageEditableValueNode[],
  ) {}
  getChildren() { return this.childEditables; }
  getObservableValue<T extends IntrinsicValueType>(type: T): IntrinsicValueValue<T>|undefined { return; }
  setObservableValue<T extends IntrinsicValueType>(type: T, value: IntrinsicValueValue<T>) {}
  resetObservableValue() {}
  getObservableOptions() { return {}; }
}

class StorageEditableValueFieldNode implements EditableValue {
  readonly multiValueState = MultiValueState.SingleValue;

  constructor(
    readonly key: string,
    readonly valueType: TypeSpec,
    private readonly parentState: Record<string, any>,
  ) {}
  get label() { return this.key; }
  getChildren() { return undefined; }
  getObservableValue<T extends IntrinsicValueType>(type: T): IntrinsicValueValue<T>|undefined {
    if (type === Number) {
      return this.parentState[this.key] as any;
    }
  }
  setObservableValue<T extends IntrinsicValueType>(type: T, value: IntrinsicValueValue<T>) {
    runInAction(() => {
      if (type === Number) {
        this.parentState[this.key] = value as any;
      }
    });
  }
  resetObservableValue() {
    runInAction(() => {
      this.parentState[this.key] = 0.2345;
    });
  }
  getObservableOptions() {
    return {
      minValue: 0.0,
      maxValue: 1.0,
    };
  }
}

function addFieldRec(
  parentState: Record<string, any>,
  parentChildEditables: StorageEditableValueNode[],
  key: string,
  fieldType: TypeSpec,
  options?: {
    newTypeMap: Map<string, TypeSpec>;
  },
) {
  fieldType = options?.newTypeMap.get(toCodeRefMapKey(fieldType.codeRef)) ?? fieldType;
  if (fieldType.struct) {
    const childEditables: StorageEditableValueNode[] = [];
    // const editableValue: EditableValue = {
    //   label: key,
    //   valueType: host.getTypeLayout(fieldType),
    //   getChildren: () => { return childEditables; },
    //   getObservableValue: <T extends IntrinsicValueType>(type: T): IntrinsicValueValue<T>|undefined => { return; },
    //   setObservableValue: action(<T extends IntrinsicValueType>(type: T, value: IntrinsicValueValue<T>) => {}),
    //   resetObservableValue: action(() => {}),
    //   getObservableOptions: () => { return {}; },
    //   multiValueState: MultiValueState.SingleValue
    // };
    parentChildEditables.push(new StorageEditableValueStructNode(
      key, fieldType, childEditables));

    const oldState = parentState[key];
    if (typeof oldState !== 'object') {
      parentState[key] = {};
    }
    const childState = parentState[key];
    for (const [k, v] of Object.entries(fieldType.struct.fields)) {
      addFieldRec(childState, childEditables, k, v, options);
    }
  } else {
    const oldState = parentState[key];
    if (typeof oldState !== 'number') {
      parentState[key] = 0.3456;
    }
    const editableValue = new StorageEditableValueFieldNode(
      key, fieldType, parentState
    );
    // const editableValue: EditableValue = {
    //   label: key,
    //   valueType: host.getTypeLayout(fieldType),
    //   getChildren: () => { return undefined; },
    //   getObservableValue: <T extends IntrinsicValueType>(type: T): IntrinsicValueValue<T>|undefined => {
    //     if (type === Number) {
    //       return parentState[key] as any;
    //     }
    //   },
    //   setObservableValue: action(<T extends IntrinsicValueType>(type: T, value: IntrinsicValueValue<T>) => {
    //     if (type === Number) {
    //       parentState[key] = value as any;
    //     }
    //   }),
    //   resetObservableValue: action(() => {
    //     parentState[key] = 0.2345;
    //   }),
    //   getObservableOptions: () => {
    //     return {
    //       minValue: 0.0,
    //       maxValue: 1.0,
    //     };
    //   },
    //   multiValueState: MultiValueState.SingleValue
    // };
    parentChildEditables.push(editableValue);
  }
}
