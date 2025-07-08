import { syncLists, MultiMap } from "../collections";
import { BusLaneLayout } from "./bus-lane-layout";
import { toCodeRefMapKey } from "./code-refs";
import { ModuleLayout, NewDecls } from "./module-layout";
import { PinLayout, PinLocation } from "./pin-layout";
import { DevicePinSource, StorageEditableValue } from "./pin-sources";
import { TrackLaneLayout } from "./track-lane-layout";
import { orRef } from "./utils";

export interface CodeModule {
}

export interface CodeRef {
  module: CodeModule;
  identifier: string;
}

export enum TypeAssignable {
  NotAssignable = '',
  SameType = 'SameType',
  WithCoersion = 'WithCoersion',
}

export interface TypeSpec {
  label?: string;
  codeRef: CodeRef;

  primitive?: {
    type: string;
  };
  struct?: {
    fields: Record<string, TypeSpec>;
  };
}

export interface PinDecl {
  label: string;
  identifier: string;
  type: TypeSpec;
}

export interface DeviceDecl {
  label: string;
  codeRef: CodeRef;
  inPins: PinDecl[];
  outPins: PinDecl[];
}

// export class TypeLayout {
//   typeSpec: TypeSpec = { codeRef: { module: {}, identifier: '' } };
// }

export class DeviceLayout {
  x: number = 0.0;
  lane?: TrackLaneLayout;
  width: number = 7;

  get maxX() { return this.x + this.width - 1; }

  readonly inPins: PinLayout[] = [];
  readonly outPins: PinLayout[] = [];

  toString() { return JSON.stringify(this.decl.label); }

  continuousEdit?: DeviceEditLayout;
  get editType() { return DeviceEditLayout; };

  constructor(readonly module: ModuleLayout, readonly uniqueKey: string, public decl: DeviceDecl) {
    syncPins.call(this, decl);
  }

  applyDecls(newDecls: NewDecls) {
    const key = toCodeRefMapKey(this.decl.codeRef);
    const newDecl = newDecls.deviceDeclsMap.get(key);
    if (newDecl) {
      const oldDecl = this.decl;
      this.decl = newDecl;
      syncPins.call(this, newDecl, newDecls);
    }
    for (const pin of this.inPins.concat(this.outPins)) {
      pin.source.applyDecls(newDecls);
    }
  }
}

function syncPins(this: DeviceLayout, newDecl: DeviceDecl, newDecls?: NewDecls) {
  syncPinList.call(this, newDecl.inPins, this.inPins, PinLocation.In, newDecls);
  syncPinList.call(this, newDecl.outPins, this.outPins, PinLocation.Out, newDecls);
}

function syncPinList(this: DeviceLayout, fromPins: PinDecl[], toPins: PinLayout[], location: PinLocation, newDecls?: NewDecls) {
  syncLists({
    from: fromPins,
    to: toPins,
    theirKey: p => p.identifier,
    ourKey: l => l.decl.identifier,
    newOurs: (p, i) => {
      const editableValue = StorageEditableValue.fromType(p.label, p.type, {});
      const source = new DevicePinSource(this, location, i);
      source.storageEditableValue = editableValue;
      const l = new PinLayout(source, location, p);
      source.pin = l;
      return l;
    },
    retainOurs: (p, l, oldIndex, newIndex) => {
      l.decl = p;
      if (l.source instanceof DevicePinSource) {
        l.source.pinIndex = newIndex;
      }
      if (newDecls) {
        l.source.applyDecls(newDecls);
      }
    },
  });
}

export class DeviceEditLayout implements DeviceLayout {
  constructor(readonly shadowOf: DeviceLayout) {}

  get module() { return this.shadowOf.module; }
  get uniqueKey() { return this.shadowOf.uniqueKey; }
  get decl() { return this.shadowOf.decl; }

  get x(): number {
    return this._x ?? this.shadowOf.x;
  }
  set x(v: number) { this._x = v; }
  private _x?: number;

  get lane(): TrackLaneLayout|undefined {
    return orRef(this._lane, this.shadowOf.lane);
  }
  set lane(v: TrackLaneLayout|undefined) { this._lane = v ?? null; }
  private _lane?: TrackLaneLayout|null;

  get width(): number { return this._width ?? this.shadowOf.width; }
  set width(v: number) { this._width = v; }
  private _width?: number;

  get maxX() { return this.x + this.width - 1; }

  get inPins(): PinLayout[] { return this.shadowOf.inPins; }
  get outPins(): PinLayout[] { return this.shadowOf.outPins; }

  toString(): string { return this.shadowOf.toString(); }

  applyDecls(newDecls: NewDecls) { return this.shadowOf.applyDecls(newDecls); }

  readonly continuousEdit = this;
  get editType() { return DeviceEditLayout; };
}


