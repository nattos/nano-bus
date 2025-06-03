import * as utils from "../../utils";
import { DeviceLayout } from "./device-layout";
import { InterconnectLayout } from "./interconnect-layout";
import { LaneLayout } from "./lane-layout";
import { TrackLaneLayout } from "./track-lane-layout";
import { canonical } from "./utils";

export class ModuleLayout {
  lanes: LaneLayout[] = [];
  allDevices: DeviceLayout[] = [];
  allInterconnects: InterconnectLayout[] = [];

  continuousEdit?: ModuleEditLayout;
  readonly editType = ModuleEditLayout;

  insertLane(lane: LaneLayout, index?: number) {
    this.lanes.splice(index ?? this.lanes.length, 0, canonical(lane));
  }
  removeLane(lane: LaneLayout) {
    utils.arrayRemove(this.lanes, canonical(lane));
  }

  insertDevice(device: DeviceLayout, index?: number) {
    this.allDevices.splice(index ?? this.allDevices.length, 0, canonical(device));
  }
  removeDevice(device: DeviceLayout) {
    utils.arrayRemove(this.allDevices, canonical(device));
  }

  insertInterconnect(interconnect: InterconnectLayout, index?: number) {
    this.allInterconnects.splice(index ?? this.allInterconnects.length, 0, canonical(interconnect));
  }
  removeInterconnect(interconnect: InterconnectLayout) {
    utils.arrayRemove(this.allInterconnects, canonical(interconnect));
  }
}

export class ModuleEditLayout implements ModuleLayout {
  constructor(readonly shadowOf: ModuleLayout) {}

  get lanes(): LaneLayout[] { return this._lanes ?? this.shadowOf.lanes; }
  private _lanes?: LaneLayout[];

  get allDevices(): DeviceLayout[] { return this._allDevices ?? this.shadowOf.allDevices; }
  private _allDevices?: DeviceLayout[];

  get allInterconnects(): InterconnectLayout[] { return this._allInterconnects ?? this.shadowOf.allInterconnects; }
  private _allInterconnects?: InterconnectLayout[];

  readonly continuousEdit = this;
  readonly editType = ModuleEditLayout;

  insertLane(lane: TrackLaneLayout, index: number) {
    this._lanes ??= Array.from(this.shadowOf.lanes);
    this._lanes.splice(index, 0, canonical(lane));
  }
  removeLane(lane: TrackLaneLayout) {
    this._lanes ??= Array.from(this.shadowOf.lanes);
    utils.arrayRemove(this._lanes, canonical(lane));
  }

  insertDevice(device: DeviceLayout, index: number) {
    this._allDevices ??= Array.from(this.shadowOf.allDevices);
    this._allDevices.splice(index, 0, canonical(device));
  }
  removeDevice(device: DeviceLayout) {
    this._allDevices ??= Array.from(this.shadowOf.allDevices);
    utils.arrayRemove(this._allDevices, canonical(device));
  }

  insertInterconnect(interconnect: InterconnectLayout, index?: number) {
    this._allInterconnects ??= Array.from(this.shadowOf.allInterconnects);
    this._allInterconnects.splice(index ?? this._allInterconnects.length, 0, canonical(interconnect));
  }
  removeInterconnect(interconnect: InterconnectLayout) {
    this._allInterconnects ??= Array.from(this.shadowOf.allInterconnects);
    utils.arrayRemove(this._allInterconnects, canonical(interconnect));
  }
}
