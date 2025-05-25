import * as utils from "../../utils";
import { MultiMap } from "../collections";
import { InterconnectLayout } from "./interconnect-layout";
import { ModuleLayout } from "./module-layout";
import { TrackLaneLayout } from "./track-lane-layout";
import { canonical, orRef } from "./utils";

export enum TypeAssignable {
  NotAssignable = '',
  SameType = 'SameType',
  WithCoersion = 'WithCoersion',
}

export interface TypeSpec {
  label?: string;
  isAssignableFrom(other: TypeSpec): TypeAssignable;
}

export interface PinDecl {
  label: string;
  type: TypeSpec;
}

export interface DeviceDecl {
  label: string;
  inPins: PinDecl[];
  outPins: PinDecl[];
}

export class TypeLayout {
  typeSpec: TypeSpec = {
    isAssignableFrom(other: TypeSpec) { return TypeAssignable.NotAssignable; }
  };
}


export class DeviceLayout {
  x: number = 0.0;
  lane?: TrackLaneLayout;
  width: number = 7;

  get maxX() { return this.x + this.width - 1; }

  readonly inPins: PinLayout[] = [];
  readonly outPins: PinLayout[] = [];

  toString() { return JSON.stringify(this.decl.label); }

  continuousEdit?: DeviceEditLayout;
  readonly editType = DeviceEditLayout;

  constructor(readonly module: ModuleLayout, readonly decl: DeviceDecl) {}
}

export class DeviceEditLayout implements DeviceLayout {
  constructor(readonly shadowOf: DeviceLayout) {}

  get module(): ModuleLayout { return this.shadowOf.module; }
  get decl(): DeviceDecl { return this.shadowOf.decl; }

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

  readonly continuousEdit = this;
  readonly editType = DeviceEditLayout;
}

// export class RoutePointLayout {
// }

export enum PinLocation {
  In = 'in',
  Out = 'out',
}

export class PinLayout {
  y: number = 0;
  type?: TypeLayout;
  readonly interconnects: InterconnectLayout[] = [];

  insertInterconnect(interconnect: InterconnectLayout, index?: number) {
    this.interconnects.splice(index ?? this.interconnects?.length, 0, canonical(interconnect));
  }
  removeInterconnect(interconnect: InterconnectLayout) {
    utils.arrayRemove(this.interconnects, canonical(interconnect));
  }

  continuousEdit?: PinEditLayout;
  readonly editType = PinEditLayout;

  constructor(readonly device: DeviceLayout, readonly location: PinLocation, readonly decl: PinDecl) {}
}

export class PinEditLayout implements PinLayout {
  constructor(readonly shadowOf: PinLayout) {}

  get device(): DeviceLayout { return this.shadowOf.device; }
  get location(): PinLocation { return this.shadowOf.location; }
  get decl(): PinDecl { return this.shadowOf.decl; }

  get y(): number { return this._y ?? this.shadowOf.y; }
  private _y?: number;

  get type(): TypeLayout|undefined { return orRef(this._type, this.shadowOf.type); }
  set type(v: TypeLayout|undefined) { this._type = v ?? null; }
  private _type?: TypeLayout|null;

  get interconnects(): InterconnectLayout[] { return this._interconnects ?? this.shadowOf.interconnects; }
  private _interconnects?: InterconnectLayout[];

  insertInterconnect(interconnect: InterconnectLayout, index?: number) {
    this._interconnects ??= Array.from(this.shadowOf.interconnects);
    this._interconnects.splice(index ?? this._interconnects?.length, 0, canonical(interconnect));
  }
  removeInterconnect(interconnect: InterconnectLayout) {
    this._interconnects ??= Array.from(this.shadowOf.interconnects);
    utils.arrayRemove(this._interconnects, canonical(interconnect));
  }

  readonly continuousEdit = this;
  readonly editType = PinEditLayout;
}
