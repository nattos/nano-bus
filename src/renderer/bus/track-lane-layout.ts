import * as utils from "../../utils";
import { MultiMap } from "../collections";
import { PinLayout, DeviceLayout } from "./device-layout";
import { ModuleLayout } from "./module-layout";
import { canonical, view } from "./utils";

export class LaneLayout {
  index: number = 0;
  y: number = 0;
  height: number = 4;
}

export class TrackLaneLayout extends LaneLayout {
  readonly devices: DeviceLayout[] = [];
  // routePoints: RoutePointLayout[] = [];

  // readonly cellMap = MultiMap.basic<number, DeviceLayout>();

  continuousEdit?: TrackLaneEditLayout;
  readonly editType = TrackLaneEditLayout;

  constructor(readonly module: ModuleLayout) {
    super();
  }

  insertDevice(device: DeviceLayout, index?: number) {
    this.devices.splice(index ?? this.devices.length, 0, canonical(device));
  }
  removeDevice(device: DeviceLayout) {
    utils.arrayRemove(this.devices, canonical(device));
  }
  sortDevices() {
    this.devices.sort((a, b) => view(a).x - view(b).x);
  }
}

export class TrackLaneEditLayout implements TrackLaneLayout {
  constructor(readonly shadowOf: TrackLaneLayout) {}

  get module(): ModuleLayout { return this.shadowOf.module; }

  get index(): number { return this._index ?? this.shadowOf.index; }
  set index(v: number) { this._index = v; }
  private _index?: number;

  get y(): number { return this._y ?? this.shadowOf.y; }
  set y(v: number) { this._y = v; }
  private _y?: number;

  get height(): number { return this._height ?? this.shadowOf.height; }
  set height(v: number) { this._height = v; }
  private _height?: number;

  get devices(): DeviceLayout[] { return this._devices ?? this.shadowOf.devices; }
  private _devices?: DeviceLayout[];

  readonly continuousEdit = this;
  readonly editType = TrackLaneEditLayout;

  insertDevice(device: DeviceLayout, index?: number) {
    this._devices ??= Array.from(this.shadowOf.devices);
    this._devices.splice(index ?? this._devices.length, 0, canonical(device));
  }
  removeDevice(device: DeviceLayout) {
    this._devices ??= Array.from(this.shadowOf.devices);
    utils.arrayRemove(this._devices, canonical(device));
  }
  sortDevices() {
    this._devices ??= Array.from(this.shadowOf.devices);
    this._devices.sort((a, b) => view(a).x - view(b).x);
  }
}
