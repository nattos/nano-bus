import { ExportLocation, PinLayout } from "./pin-layout";
import { LaneLayout } from "./lane-layout";
import { view } from "./utils";

export enum InterconnectType {
  Explicit = 'explicit',
  Computed = 'computed',
  Implicit = 'implicit',
}

export class InterconnectLayout {
  path: PathPoint[] = [];

  continuousEdit?: InterconnectEditLayout;
  get editType() { return InterconnectEditLayout; };

  constructor(readonly start: PinLayout, readonly end: PinLayout, readonly type: InterconnectType) {}

  getExportLocation(): ExportLocation|undefined {
    return this.start.source.getExportLocation?.();
  }
}

export class InterconnectEditLayout {
  constructor(readonly shadowOf: InterconnectLayout) {}

  get start(): PinLayout { return this.shadowOf.start; }
  get end(): PinLayout { return this.shadowOf.end; }
  get type(): InterconnectType { return this.shadowOf.type; }

  get path(): PathPoint[] { return this._path ?? this.shadowOf.path; }
  set path(v: PathPoint[]) { this._path = v; }
  private _path?: PathPoint[];

  readonly continuousEdit = this;
  get editType() { return InterconnectEditLayout; };

  getExportLocation() {
    return this.shadowOf.getExportLocation();
  }
}

export interface PathPoint {
  lane: LaneLayout;
  laneLocalY: number;
  x: number;
  xLocalX: number;
}
