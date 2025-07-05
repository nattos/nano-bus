import * as utils from "../../utils";
import { TypeLayout, PinDecl, DeviceLayout } from "./device-layout";
import { EditableValue } from "./editable-value";
import { InterconnectLayout } from "./interconnect-layout";
import { LaneLayout } from "./lane-layout";
import { canonical, orRef } from "./utils";

// export class RoutePointLayout {
// }

export enum PinLocation {
  In = 'in',
  Out = 'out'
}

export interface PinSource {
  get x(): number;
  get laneLocalY(): number;
  get lane(): LaneLayout|undefined;
  get label(): string;
  get sourceLabel(): string;
  get editableValue(): EditableValue|undefined;
  markDirty(): void;
  getExportLocation?(): ExportLocation|undefined;
  continuousEdit?: PinSource;
}

export interface ExportLocation {
  device: DeviceLayout;
  outPin: PinLayout;
}

export interface PinOptions {
  allowImplicitInterconnects?: boolean;
  connectToBus?: BusRef;
}

export interface BusRef {
  byName?: string;
}

export class PinLayout {
  type?: TypeLayout;
  options: PinOptions = {};
  readonly interconnects: InterconnectLayout[] = [];

  insertInterconnect(interconnect: InterconnectLayout, index?: number) {
    this.interconnects.splice(index ?? this.interconnects?.length, 0, canonical(interconnect));
  }
  removeInterconnect(interconnect: InterconnectLayout) {
    utils.arrayRemove(this.interconnects, canonical(interconnect));
  }

  continuousEdit?: PinEditLayout;
  get editType() { return PinEditLayout; };

  constructor(readonly source: PinSource, readonly location: PinLocation, readonly decl: PinDecl) { }
}

export class PinEditLayout implements PinLayout {
  constructor(readonly shadowOf: PinLayout) { }

  get source(): PinSource { return this.shadowOf.source; }
  get location(): PinLocation { return this.shadowOf.location; }
  get decl(): PinDecl { return this.shadowOf.decl; }

  get type(): TypeLayout | undefined { return orRef(this._type, this.shadowOf.type); }
  set type(v: TypeLayout | undefined) { this._type = v ?? null; }
  private _type?: TypeLayout | null;

  get options(): PinOptions { return this._options ?? this.shadowOf.options; }
  set options(v: PinOptions) { this._options = v; }
  private _options?: PinOptions;

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
  get editType() { return PinEditLayout; };
}
