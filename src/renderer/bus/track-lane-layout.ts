import * as utils from "../../utils";
import { MultiMap } from "../collections";
import { DeviceLayout } from "./device-layout";
import { PinLayout } from "./pin-layout";
import { LaneEditLayout, LaneLayout } from "./lane-layout";
import { ModuleLayout } from "./module-layout";
import { canonical, view } from "./utils";

export function isTrackLane(lane?: LaneLayout): lane is TrackLaneLayout {
  return canonical(lane) instanceof TrackLaneLayout;
}

export class TrackLaneLayout extends LaneLayout {
  readonly devices: DeviceLayout[] = [];
  // routePoints: RoutePointLayout[] = [];

  // readonly cellMap = MultiMap.basic<number, DeviceLayout>();

  continuousEdit: TrackLaneEditLayout|undefined;
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

export class TrackLaneEditLayout extends LaneEditLayout implements TrackLaneLayout {
  constructor(readonly shadowOf: TrackLaneLayout) {
    super(shadowOf);
  }

  get module(): ModuleLayout { return this.shadowOf.module; }

  get devices(): DeviceLayout[] { return this._devices ?? this.shadowOf.devices; }
  private _devices?: DeviceLayout[];

  get continuousEdit() { return this; }
  get editType() { return TrackLaneEditLayout; }

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
