import * as utils from "../../utils";
import { MultiMap } from "../collections";
import { DeviceDecl, DeviceEditLayout, DeviceLayout, PinLayout, PinLocation, TypeSpec } from "./device-layout";
import { InterconnectLayout, InterconnectType, PathPoint } from "./interconnect-layout";
import { ModuleLayout } from "./module-layout";
import { LaneLayout, TrackLaneEditLayout, TrackLaneLayout } from "./track-lane-layout";
import { canonical, edit, Editable, view } from "./utils";

interface ContinuousEditable<T> {
  continuousEdit?: T;
}

export class EditOperation {
  static continuousEdit?: EditOperation;

  public readonly label: string;
  public onLanesEdited?: (lanes: TrackLaneLayout[]) => void;
  public onDevicesEdited?: (devices: DeviceLayout[]) => void;
  public onInterconnectsEdited?: () => void;

  private lanesDirty = false;
  private autoInterconnectsDirty = false;
  private readonly editedLanes = new Set<TrackLaneLayout>();
  private readonly editedDevices = new Set<DeviceLayout>();
  private readonly dirtyInterconnects = new Set<InterconnectLayout>();
  private isContinuous;
  private continuousEdits = new Set<ContinuousEditable<unknown>>();
  private continuousApplyFunc?: () => void;

  constructor(readonly module: ModuleLayout, options?: { label?: string; isContinuous?: boolean; }) {
    this.label = options?.label ?? 'unknown';
    this.isContinuous = options?.isContinuous ?? false;

    if (this.isContinuous) {
      if (EditOperation.continuousEdit) {
        throw new Error(`Cannot start continuous edit ${this.label}. Edit ${EditOperation.continuousEdit.label} is already in progress.`);
      }
      EditOperation.continuousEdit = this;
    }
  }

  insertLane(y?: number) {
    const module = edit(this.module);
    y ??= module.lanes.length;
    const lane = new TrackLaneLayout(this.module);
    lane.y = y;
    module.insertLane(lane);
    this.lanesDirty = true;
    return lane;
  }

  insertDevice(init: { lane: TrackLaneLayout; x?: number; decl: DeviceDecl; }) {
    const module = edit(this.module);
    const lane = edit(init.lane);
    const x = (init.x ?? lane.devices.at(-1)?.maxX ?? 0) | 0;
    const device = new DeviceLayout(this.module, init.decl);
    using _ = new DevicePositionUpdate(this, lane, device, { isNew: true });
    device.x = x;
    device.lane = canonical(lane);
    lane.insertDevice(device);
    module.insertDevice(device);

    // TODO: Make dynamic.
    device.inPins.push(...init.decl.inPins.map(p => new PinLayout(device, PinLocation.In, p)));
    device.outPins.push(...init.decl.outPins.map(p => new PinLayout(device, PinLocation.Out, p)));
    device.inPins.forEach((p, i) => p.y = i);
    device.outPins.forEach((p, i) => p.y = i);

    this.editedLanes.add(canonical(lane));
    this.editedDevices.add(canonical(device));
    this.autoInterconnectsDirty = true;
    return device;
  }

  moveDevice(init: { device: DeviceLayout; x: number; lane?: TrackLaneLayout }) {
    const device = edit(init.device);
    using _ = new DevicePositionUpdate(this, device.lane, device);
    device.x = init.x | 0;
    if (canonical(device.lane) !== canonical(init.lane)) {
      if (device.lane) {
        const oldLane = edit(device.lane);
        oldLane.removeDevice(device);
        this.editedLanes.add(canonical(oldLane));
      }
      if (init.lane) {
        const newLane = edit(init.lane);
        newLane.insertDevice(device);
        this.editedLanes.add(canonical(newLane));
      }
      device.lane = canonical(init.lane);
      this.lanesDirty = true;
    }

    this.autoInterconnectsDirty = true;
    this.editedDevices.add(canonical(device));
  }

  connectPins(init: { fromOutPin: PinLayout; toInPin: PinLayout; type?: InterconnectType }) {
    const module = edit(this.module);
    const fromOutPin = edit(init.fromOutPin);
    const toInPin = edit(init.toInPin);

    this.disconnectPin({ pin: toInPin });

    const interconnect = new InterconnectLayout(fromOutPin, toInPin, init?.type ?? InterconnectType.Explicit);
    fromOutPin.insertInterconnect(interconnect);
    toInPin.insertInterconnect(interconnect);
    module.insertInterconnect(interconnect);
    this.dirtyInterconnects.add(interconnect);
  }
  disconnectPin(init: { pin: PinLayout; }) {
    if (view(init.pin).interconnects.length === 0) {
      return;
    }
    const pin = edit(init.pin);
    const toDisconnect = Array.from(pin.interconnects);
    for (const interconnect of toDisconnect) {
      this.disconnect({ interconnect });
    }
  }
  disconnect(init: { interconnect: InterconnectLayout; }) {
    const module = edit(this.module);
    const interconnect = edit(init.interconnect);
    const fromOutPin = edit(interconnect.start);
    const toInPin = edit(interconnect.end);
    fromOutPin.removeInterconnect(interconnect);
    toInPin.removeInterconnect(interconnect);
    module.removeInterconnect(interconnect);
  }

  write(f: () => void) {
    if (this.isContinuous) {
      this.continuousApplyFunc = f;
      this.resetContinuous();
      this.applyContinuous();
    } else {
      f();
    }
  }
  cancel() {
    if (!this.isContinuous) {
      throw new Error(`Cannot cancel non-continous edit ${this.label}`);
    }
    if (EditOperation.continuousEdit === this) {
      EditOperation.continuousEdit = undefined;
      this.resetContinuous();
      this.continuousApplyFunc = undefined;
    }
  }

  ensureEditable<T extends Editable<T>>(v: T): T {
    v.continuousEdit ??= new v.editType(v);
    this.continuousEdits.add(v);
    return v.continuousEdit;
  }

  [Symbol.dispose]() {
    try {
      if (this.isContinuous) {
        this.commitContinuous();
      } else {
        this.cleanup();
      }
    } finally {
      if (EditOperation.continuousEdit === this) {
        EditOperation.continuousEdit = undefined;
      }
    }
  }

  private cleanup() {
    const module = view(this.module);

    // Cleanup lanes.
    if (this.lanesDirty) {
      this.lanesDirty = false;
      module.lanes.forEach((lane, i) => {
        const newIndex = i;
        const newY = i * 5;
        const viewLane = view(lane);
        if (viewLane.index === newIndex && viewLane.y === newY) {
          return;
        }
        const editLane = edit(lane);
        editLane.index = newIndex;
        editLane.y = newY;
        this.editedLanes.add(canonical(editLane));
      });
    }

    // Cleanup device positioning.
    // TODO: Optimize device shifting.
    this.cleanupDevices();

    // Compute new implicit interconnects.
    // TODO: Only recomputing affected interconnects.
    if (this.autoInterconnectsDirty) {
      this.autoInterconnectsDirty = false;
      this.recomputeAutoInterconnects();
    }
    for (const device of this.editedDevices) {
      for (const outPin of view(device).outPins) {
        for (const interconnect of view(outPin).interconnects) {
          this.dirtyInterconnects.add(interconnect);
        }
      }
      for (const inPin of view(device).inPins) {
        for (const interconnect of view(inPin).interconnects) {
          this.dirtyInterconnects.add(interconnect);
        }
      }
    }
    // Redraw interconnects.
    for (const interconnect of this.dirtyInterconnects) {
      this.recomputePath(edit(interconnect));
    }

    if (this.editedLanes.size) {
      if (this.onLanesEdited) {
        const movedLanes = Array.from(this.editedLanes).map(l => canonical(l));
        this.onLanesEdited(movedLanes);
      }
      this.editedLanes.clear();
    }
    if (this.editedDevices.size) {
      if (this.onDevicesEdited) {
        const movedDevices = Array.from(this.editedDevices).map(d => canonical(d));
        this.onDevicesEdited(movedDevices);
      }
      this.editedDevices.clear();
    }
    // TODO: Lol interconnects are basically always changing at the moment.
    if (this.dirtyInterconnects.size) {
      this.onInterconnectsEdited?.();
    }
    this.dirtyInterconnects.clear();
  }

  private commitContinuous() {
    if (!this.isContinuous) {
      throw new Error(`Cannot commit non-continous edit ${this.label}`);
    }
    if (EditOperation.continuousEdit === this) {
      EditOperation.continuousEdit = undefined;
    }
    this.resetContinuous();
    this.applyContinuous();
  }

  private resetContinuous() {
    if (!this.isContinuous) {
      throw new Error(`Cannot reset non-continous edit ${this.label}`);
    }
    for (const edit of this.continuousEdits) {
      edit.continuousEdit = undefined;
      if (edit instanceof TrackLaneLayout) {
        this.editedLanes.add(canonical(edit));
      }
      if (edit instanceof DeviceLayout) {
        this.editedDevices.add(canonical(edit));
      }
    }
    this.continuousEdits.clear();
  }

  private applyContinuous() {
    if (!this.isContinuous) {
      throw new Error(`Cannot apply non-continous edit ${this.label}`);
    }
    this.continuousApplyFunc?.();
    this.cleanup();
  }

  private cleanupDevices() {
    const module = view(this.module);
    for (const lane of module.lanes) {
      this.sortLaneDevices(lane);
      this.splayLaneDevices(lane);
    }
  }

  private sortLaneDevices(toSort: TrackLaneLayout) {
    const lane = view(toSort);
    let needsSort = false;
    let prevX = 0;
    for (const rawDevice of lane.devices) {
      const device = view(rawDevice);
      const nextX = device.x;
      if (nextX < prevX) {
        needsSort = true;
        break;
      }
      prevX = nextX;
    }
    if (!needsSort) {
      return;
    }
    const editLane = edit(lane);
    editLane.sortDevices();
    this.editedLanes.add(canonical(editLane));
  }

  private splayLaneDevices(toSort: TrackLaneLayout) {
    const lane = view(toSort);
    let prevMaxX = 0;
    for (const rawDevice of lane.devices) {
      const device = view(rawDevice);
      const nextMinX = device.x;
      let nextMaxX = device.maxX + 1;
      if (nextMinX < prevMaxX) {
        const editDevice = edit(device);
        editDevice.x = prevMaxX;
        nextMaxX = editDevice.maxX + 1;
        this.editedDevices.add(canonical(editDevice));
      }
      prevMaxX = nextMaxX;
    }
  }

  private recomputeAutoInterconnects() {
    const module = view(this.module);
    // For now, break all interconnects and reconnect by sweeping from left to right.
    for (const interconnect of Array.from(module.allInterconnects)) {
      if (interconnect.type === InterconnectType.Implicit) {
        this.disconnect({ interconnect });
      }
    }

    const allDevices = module.lanes.flatMap(l => view(l).devices.map(d => view(d)));
    allDevices.sort((a, b) => a.x - b.x);

    const exported = MultiMap.basic<TypeSpec, PinLayout>();
    for (const rawDevice of allDevices) {
      const device = view(rawDevice);
      const defaultY = view(device.lane)?.y ?? 0;

      // Look for matching ins.
      const disconnectedPins = device.inPins.map(p => view(p)).filter(p => !p.interconnects.length);
      const connectedPins = device.inPins.map(p => view(p)).filter(p => p.interconnects.length);
      const consumedExportsSet = new Set(connectedPins.flatMap(p => p.interconnects.map(ic => ic.start)));

      const pinsByType = utils.groupBy(disconnectedPins, p => p.decl.type);

      for (const [pinType, toConnectPins] of pinsByType.entries()) {
        const candidateSet = exported.get(pinType);
        if (!candidateSet) {
          break;
        }
        const candidates =
          Array.from(candidateSet)
          .filter(c => !consumedExportsSet.has(c) && view(c.device).maxX  < device.x)
          .toSorted((a, b) => {
            const xDiff = view(b.device).x - view(a.device).x;
            return xDiff;
          })
          .slice(0, toConnectPins.length)
          .toSorted((a, b) => {
            const yDiff = (view(view(a.device).lane)?.y ?? defaultY) - (view(view(b.device).lane)?.y ?? defaultY);
            return yDiff;
          });
        for (const [inPin, outPin] of utils.zip(toConnectPins, candidates)) {
          this.connectPins({ fromOutPin: outPin, toInPin: inPin, type: InterconnectType.Implicit });
        }
      }

      for (const outPin of device.outPins) {
        exported.add(outPin.decl.type, outPin);
      }
    }
  }

  private recomputePath(interconnect: InterconnectLayout) {
    interconnect.path = this.computePath(interconnect) ?? [];
  }

  private computePath(interconnect: InterconnectLayout): PathPoint[]|undefined {
    const startPin = view(interconnect.start);
    const endPin = view(interconnect.end);
    const startDevice = view(startPin.device);
    const endDevice = view(endPin.device);
    const startLane = view(startDevice.lane);
    const endLane = view(endDevice.lane);

    const midX = (Math.round((startDevice.maxX + endDevice.x) / 2)) | 0;

    if (!startLane || !endLane) {
      return;
    }
    const newPoints: PathPoint[] = [];
    newPoints.push({
      lane: startLane,
      laneLocalY: startPin.y + 0.5,
      x: startDevice.maxX,
      xLocalX: 0,
    });
    newPoints.push({
      lane: startLane,
      laneLocalY: startPin.y + 0.5,
      x: midX,
      xLocalX: 0.5,
    });
    newPoints.push({
      lane: endLane,
      laneLocalY: endPin.y + 0.5,
      x: midX,
      xLocalX: 0.5,
    });
    newPoints.push({
      lane: endLane,
      laneLocalY: endPin.y + 0.5,
      x: endDevice.x,
      xLocalX: 0,
    });
    return newPoints;
  }
}

class DevicePositionUpdate {
  private startMinX;
  private startMaxX;
  constructor(
    readonly edit: EditOperation,
    readonly track: TrackLaneLayout|undefined,
    readonly device: DeviceLayout,
    readonly options?: { isNew?: boolean; },
  ) {
    this.startMinX = device.x;
    this.startMaxX = device.maxX;
  }

  [Symbol.dispose]() {
    if (!this.track) {
      return;
    }
    const isNew = this.options?.isNew;
    const startMinX = isNew ? -1 : this.startMinX;
    const startMaxX = isNew ? -1 : (this.startMaxX + 1);
    const endMinX = this.device.x;
    const endMaxX = this.device.maxX + 1;

  //   if (!isNew) {
  //     for (let x = startMinX; x < Math.min(startMaxX, endMinX); ++x) {
  //       // Removed.
  //       this.track.cellMap.remove(x, this.device);
  //       console.log(`this.track.cellMap.remove(${x}, ${this.device});`);
  //     }
  //     for (let x = Math.max(startMinX, endMaxX); x < startMaxX; ++x) {
  //       // Removed.
  //       this.track.cellMap.remove(x, this.device);
  //       console.log(`this.track.cellMap.remove(${x}, ${this.device});`);
  //     }
  //   }
  //   for (let x = endMinX; x < Math.min(startMaxX, endMaxX); ++x) {
  //     // Added.
  //     this.track.cellMap.add(x, this.device);
  //     console.log(`this.track.cellMap.add(${x}, ${this.device});`);
  //   }
  //   for (let x = Math.max(startMaxX, endMinX); x < endMaxX; ++x) {
  //     // Added.
  //     this.track.cellMap.add(x, this.device);
  //     console.log(`this.track.cellMap.add(${x}, ${this.device});`);
  //   }
  }
}
