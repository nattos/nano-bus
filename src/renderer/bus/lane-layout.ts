import * as utils from "../../utils";
import { MultiMap } from "../collections";
import { DeviceLayout } from "./device-layout";
import { PinLayout } from "./pin-layout";
import { ModuleLayout } from "./module-layout";
import { canonical, view } from "./utils";

export abstract class LaneLayout {
  index: number = 0;
  y: number = 0;
  height: number = 5;

  abstract get continuousEdit(): LaneEditLayout|undefined;
  abstract get editType(): typeof LaneEditLayout;
}

export class LaneEditLayout implements LaneLayout {
  constructor(readonly shadowOf: LaneLayout) {}

  get index(): number { return this._index ?? this.shadowOf.index; }
  set index(v: number) { this._index = v; }
  private _index?: number;

  get y(): number { return this._y ?? this.shadowOf.y; }
  set y(v: number) { this._y = v; }
  private _y?: number;

  get height(): number { return this._height ?? this.shadowOf.height; }
  set height(v: number) { this._height = v; }
  private _height?: number;

  get continuousEdit(): LaneEditLayout|undefined { throw new Error('Invalid operation.'); }
  get editType(): typeof LaneEditLayout { throw new Error('Invalid operation.'); }
}
