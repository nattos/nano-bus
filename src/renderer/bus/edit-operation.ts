import * as utils from "../../utils";
import { MultiMap } from "../collections";
import { CodeRef, DeviceDecl, DeviceEditLayout, DeviceLayout, PinDecl, TypeSpec } from "./device-layout";
import { BusRef, ExportLocation, PinLayout, PinLocation, PinOptions, PinSource } from "./pin-layout";
import { InterconnectLayout, InterconnectType, PathPoint } from "./interconnect-layout";
import { collectAll, ModuleLayout, toDeclMap } from "./module-layout";
import { isTrackLane, TrackLaneEditLayout, TrackLaneLayout } from "./track-lane-layout";
import { canonical, edit, Editable, view } from "./utils";
import { BusLaneLayout, isBusLane } from "./bus-lane-layout";
import { LaneLayout } from "./lane-layout";
import { EditableValue, IntrinsicValueType, IntrinsicValueValue, MultiValueState } from "./editable-value";
import { action, observable, runInAction } from "mobx";
import { BusLaneEphemeralPinSource, DevicePinSource, StorageEditableValue } from "./pin-sources";
import { toCodeRefMapKey } from "./code-refs";

interface ContinuousEditable<T> {
  shadowOf?: ContinuousEditable<T>;
  continuousEdit?: T;
}

export class EditOperation {
  static continuousEdit?: EditOperation;

  public readonly label: string;
  public onLanesEdited?: (lanes: LaneLayout[]) => void;
  public onDevicesEdited?: (devices: DeviceLayout[]) => void;
  public onInterconnectsEdited?: () => void;
  public onCommitted?: () => void;
  public onCompleted?: () => void;

  private lanesDirty = false;
  private autoInterconnectsDirty = false;
  private readonly editedLanes = new Set<LaneLayout>();
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

  insertBusLane(y?: number) {
    const module = edit(this.module);
    y ??= module.lanes.length;
    const lane = new BusLaneLayout(this.module);
    lane.y = y;
    module.insertLane(lane);
    this.lanesDirty = true;
    return lane;
  }

  insertDevice(init: { lane: TrackLaneLayout; x?: number; decl: DeviceDecl; }) {
    const module = edit(this.module);
    const lane = edit(init.lane);
    const x = (init.x ?? lane.devices.at(-1)?.maxX ?? 0) | 0;
    const uniqueKey = crypto.randomUUID();
    const device = new DeviceLayout(this.module, uniqueKey, init.decl);
    using _ = new DevicePositionUpdate(this, lane, device, { isNew: true });
    device.x = x;
    device.lane = canonical(lane);
    lane.insertDevice(device);
    module.insertDevice(device);

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

  setPinOptions(init: { pin: PinLayout; options: PinOptions }) {
    const pin = edit(init.pin);
    pin.options = structuredClone(init.options);
    pin.source.markDirty();
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

  applyDecls(devices: DeviceDecl[]) {
    const {
      allDevices,
      allLanes,
      allPins,
      allInterconnects,
      deviceDeclMap,
      typeDeclMap,
    } = collectAll(this.module);
    const newPinDecls: PinDecl[] = utils.unique([
      ...devices.flatMap(d => d.inPins.concat(d.outPins)),
    ]);
    const newTypeDecls: TypeSpec[] = utils.unique([
      ...newPinDecls.flatMap(p => p.type),
    ]);
    const newDeviceDeclsMap = toDeclMap(devices);
    const newTypeDeclsMap = toDeclMap(newTypeDecls);
    const newDecls = {
      deviceDeclsMap: newDeviceDeclsMap,
      typeDeclsMap: newTypeDeclsMap,
    };

    for (const device of allDevices) {
      device.applyDecls(newDecls);
    }
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
      this.onCommitted?.();
    } catch (e) {
      // Webpack doesn't report the actual error, so log it here.
      console.error(e);
      throw e;
    } finally {
      if (EditOperation.continuousEdit === this) {
        EditOperation.continuousEdit = undefined;
      }
      this.onCompleted?.();
    }
  }

  private cleanup() {
    const module = view(this.module);

    // Cleanup lanes.
    if (this.lanesDirty) {
      this.lanesDirty = false;
      let nextY = 0;
      module.lanes.forEach((lane, i) => {
        const viewLane = view(lane);
        const newIndex = i;
        const newY = nextY;
        nextY += viewLane.height;
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
      const canonicalValue = edit.shadowOf ?? edit;
      canonicalValue.continuousEdit = undefined;
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
      if (isTrackLane(lane)) {
        this.sortLaneDevices(lane);
        this.splayLaneDevices(lane);
      }
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
      if (interconnect.type === InterconnectType.Implicit || interconnect.type === InterconnectType.Computed) {
        this.disconnect({ interconnect });
      }
    }

    const allBusLanes = module.lanes.filter(isBusLane).map(l => edit(l));
    const allDevices = module.lanes.filter(isTrackLane).flatMap(l => view(l).devices.map(d => view(d)));
    allDevices.sort((a, b) => a.x - b.x);

    function derefBusLane(busRef: BusRef, y: number) {
      // TODO: Support bus names.
      return allBusLanes.find(l => l.y >= y) ?? allBusLanes.at(-1);
    }

    const exported = MultiMap.basic<TypeSpec, { pin: PinLayout; exportAnywhere: boolean; }>();

    // Reconnect computed pins, like bus exports.
    for (const busLane of allBusLanes) {
      busLane.clearImportPins();
      busLane.clearExportPins();
    }
    for (const rawDevice of allDevices) {
      const device = view(rawDevice);
      for (const rawOutPin of device.outPins) {
        const outPin = view(rawOutPin);
        if (outPin.options.connectToBus) {
          const foundBusLane = derefBusLane(outPin.options.connectToBus, view(view(outPin.source).lane)?.y ?? 0);
          if (foundBusLane) {
            // Add a ephemeral pin on the bus lane, and connect to it.
            const source = new BusLaneEphemeralPinSource(foundBusLane, outPin);
            const newPin = new PinLayout(source, PinLocation.In, outPin.decl);
            foundBusLane.insertImportPin(newPin);
            this.connectPins({ fromOutPin: outPin, toInPin: newPin, type: InterconnectType.Computed });
            exported.add(newPin.decl.type, { pin: newPin, exportAnywhere: true, });
          }
        }
      }
    }

    // Now connect remaining implicit in/out pins.
    for (const rawDevice of allDevices) {
      const device = view(rawDevice);

      // Look for matching ins.
      const disconnectedPins = device.inPins.map(p => view(p)).filter(p => !p.interconnects.length);
      const connectedPins = device.inPins.map(p => view(p)).filter(p => p.interconnects.length);
      const consumedExportsSet = new Set(connectedPins.flatMap(p => p.interconnects.map(ic => ic.start)));

      const pinsByType = utils.groupBy(disconnectedPins, p => p.decl.type);

      for (const [pinType, toConnectPinsAll] of pinsByType.entries()) {
        const toConnectPinsBus = toConnectPinsAll.filter(p => p.options.connectToBus);
        const toConnectPinsNoBus = toConnectPinsAll.filter(p => !p.options.connectToBus);
        const toConnectPinSets = [
          { toConnectPins: toConnectPinsBus, fromBusOnly: true },
          { toConnectPins: toConnectPinsNoBus, fromBusOnly: false },
        ];
        for (const { toConnectPins, fromBusOnly: fromBusOnly } of toConnectPinSets) {
          const candidateSet = exported.get(pinType);
          if (!candidateSet) {
            break;
          }
          const candidates =
            Array.from(candidateSet)
            .filter(c => !fromBusOnly || c.exportAnywhere)
            .filter(c => !consumedExportsSet.has(c.pin) && (c.exportAnywhere || view(c.pin.source).x  < device.x))
            .toSorted((a, b) => {
              const xDiff = view(b.pin.source).x - view(a.pin.source).x;
              const aValue = a.exportAnywhere ? 1 : 0;
              const bValue = b.exportAnywhere ? 1 : 0;
              const busDiff = aValue - bValue;
              return busDiff || xDiff;
            })
            .slice(0, toConnectPins.length)
            .map(c => c.pin)
            .toSorted((a, b) => {
              const yDiff = view(a.source).laneLocalY - view(b.source).laneLocalY;
              return yDiff;
            });
          for (const [inPin, outPin] of utils.zip(toConnectPins, candidates)) {
            this.connectPins({ fromOutPin: outPin, toInPin: inPin, type: InterconnectType.Implicit });
            consumedExportsSet.add(outPin);
          }
        }
      }

      for (const rawOutPin of device.outPins) {
        const outPin = view(rawOutPin);
        let defaultIsExported = true;
        if (outPin.options.connectToBus) {
          // When a pin is exporting to a bus, implicit interconnects are disabled by default, and must be forced on.
          defaultIsExported = false;
        }
        const isExported = outPin.options.allowImplicitInterconnects ?? defaultIsExported;
        if (isExported) {
          exported.add(outPin.decl.type, { pin: outPin, exportAnywhere: false });
        }
      }
    }
  }

  private recomputePath(interconnect: InterconnectLayout) {
    interconnect.path = this.computePath(interconnect) ?? [];
  }

  private computePath(interconnect: InterconnectLayout): PathPoint[]|undefined {
    const startPin = view(interconnect.start);
    const endPin = view(interconnect.end);
    const startSource = view(startPin.source);
    const endSource = view(endPin.source);
    const startLane = view(startSource.lane);
    const endLane = view(endSource.lane);

    const debugFakeBias = startSource.laneLocalY / 8;
    const midX = ((Math.round((startSource.x + endSource.x) / 2)) | 0) + debugFakeBias;

    if (!startLane || !endLane) {
      return;
    }
    const newPoints: PathPoint[] = [];
    newPoints.push({
      lane: startLane,
      laneLocalY: startSource.laneLocalY + 0.5 + debugFakeBias,
      x: startSource.x,
      xLocalX: 0,
    });
    newPoints.push({
      lane: startLane,
      laneLocalY: startSource.laneLocalY + 0.5 + debugFakeBias,
      x: midX,
      xLocalX: 0.5,
    });
    newPoints.push({
      lane: endLane,
      laneLocalY: endSource.laneLocalY + 0.5 + debugFakeBias,
      x: midX,
      xLocalX: 0.5,
    });
    newPoints.push({
      lane: endLane,
      laneLocalY: endSource.laneLocalY + 0.5 + debugFakeBias,
      x: endSource.x,
      xLocalX: 0,
    });
    return newPoints;
  }

  // private makeType(typeSpec: TypeSpec) {
  //   // TODO: Implement!
  //   const type = new TypeLayout();
  //   type.typeSpec = typeSpec;
  //   return type;
  // }
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
