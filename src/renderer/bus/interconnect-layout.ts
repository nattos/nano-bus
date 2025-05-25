import { PinLayout } from "./device-layout";
import { LaneLayout } from "./track-lane-layout";

export enum InterconnectType {
  Explicit = 'explicit',
  Implicit = 'implicit',
}

export class InterconnectLayout {
  path: PathPoint[] = [];

  continuousEdit?: InterconnectEditLayout;
  readonly editType = InterconnectEditLayout;

  constructor(readonly start: PinLayout, readonly end: PinLayout, readonly type: InterconnectType) {}
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
  readonly editType = InterconnectEditLayout;
}

export interface PathPoint {
  lane: LaneLayout;
  laneLocalY: number;
  x: number;
  xLocalX: number;
}
