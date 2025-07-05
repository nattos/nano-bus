import * as utils from "../../utils";
import { MultiMap } from "../collections";
import { DeviceLayout } from "./device-layout";
import { PinLayout } from "./pin-layout";
import { LaneEditLayout, LaneLayout } from "./lane-layout";
import { ModuleLayout } from "./module-layout";
import { canonical, view } from "./utils";

export function isBusLane(lane?: LaneLayout): lane is BusLaneLayout {
  return lane?.type === 'bus';
}

export class BusLaneLayout extends LaneLayout {
  override readonly type = 'bus' as const;

  readonly importPins: PinLayout[] = [];
  readonly exportPins: PinLayout[] = [];

  continuousEdit: BusLaneEditLayout|undefined;
  get editType() { return BusLaneEditLayout; };

  constructor(readonly module: ModuleLayout) {
    super();
    this.height = 1;
  }

  insertImportPin(v: PinLayout, index?: number) {
    this.importPins.splice(index ?? this.importPins.length, 0, canonical(v));
  }
  removeImportPin(v: PinLayout) {
    utils.arrayRemove(this.importPins, canonical(v));
  }
  clearImportPins() {
    this.importPins.splice(0);
  }
  sortImportPins() {
    this.importPins.sort((a, b) => view(view(a).source).x - view(view(b).source).x);
  }

  insertExportPin(v: PinLayout, index?: number) {
    this.exportPins.splice(index ?? this.exportPins.length, 0, canonical(v));
  }
  removeExportPin(v: PinLayout) {
    utils.arrayRemove(this.exportPins, canonical(v));
  }
  clearExportPins() {
    this.exportPins.splice(0);
  }
  sortExportPins() {
    this.exportPins.sort((a, b) => view(view(a).source).x - view(view(b).source).x);
  }
}

export class BusLaneEditLayout extends LaneEditLayout implements BusLaneLayout {
  constructor(readonly shadowOf: BusLaneLayout) {
    super(shadowOf);
  }

  override get type() { return this.shadowOf.type; }

  get module(): ModuleLayout { return this.shadowOf.module; }

  get importPins(): PinLayout[] { return this._importPins ?? this.shadowOf.importPins; }
  private _importPins?: PinLayout[];

  get exportPins(): PinLayout[] { return this._exportPins ?? this.shadowOf.exportPins; }
  private _exportPins?: PinLayout[];

  get continuousEdit() { return this; }
  get editType() { return BusLaneEditLayout; }

  insertImportPin(v: PinLayout, index?: number) {
    this._importPins ??= Array.from(this.shadowOf.importPins);
    this._importPins.splice(index ?? this._importPins.length, 0, canonical(v));
  }
  removeImportPin(v: PinLayout) {
    this._importPins ??= Array.from(this.shadowOf.importPins);
    utils.arrayRemove(this._importPins, canonical(v));
  }
  clearImportPins() {
    this._exportPins = [];
  }
  sortImportPins() {
    this._importPins ??= Array.from(this.shadowOf.importPins);
    this._importPins.sort((a, b) => view(view(a).source).x - view(view(b).source).x);
  }

  insertExportPin(v: PinLayout, index?: number) {
    this._exportPins ??= Array.from(this.shadowOf.exportPins);
    this._exportPins.splice(index ?? this._exportPins.length, 0, canonical(v));
  }
  removeExportPin(v: PinLayout) {
    this._exportPins ??= Array.from(this.shadowOf.exportPins);
    utils.arrayRemove(this._exportPins, canonical(v));
  }
  clearExportPins() {
    this._exportPins = [];
  }
  sortExportPins() {
    this._exportPins ??= Array.from(this.shadowOf.exportPins);
    this._exportPins.sort((a, b) => view(view(a).source).x - view(view(b).source).x);
  }
}
