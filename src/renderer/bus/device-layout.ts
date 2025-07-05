import { MultiMap } from "../collections";
import { BusLaneLayout } from "./bus-lane-layout";
import { ModuleLayout } from "./module-layout";
import { PinLayout } from "./pin-layout";
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
  codeRef: CodeRef;
  type: TypeSpec;
}

export interface DeviceDecl {
  label: string;
  codeRef: CodeRef;
  inPins: PinDecl[];
  outPins: PinDecl[];
}

export class TypeLayout {
  typeSpec: TypeSpec = { codeRef: { module: {}, identifier: '' } };
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
  get editType() { return DeviceEditLayout; };

  constructor(readonly module: ModuleLayout, readonly uniqueKey: string, readonly decl: DeviceDecl) {}
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

  readonly continuousEdit = this;
  get editType() { return DeviceEditLayout; };
}


